# NeonStage — Architecture

NeonStage is a Windows-first Electron desktop app for designing and controlling transparent OBS overlays.
The desktop app is the editor/controller; OBS renders a clean output page served by the running app on loopback.

Reference: NeonAmp (`C:/Users/marus/NeonAmp`) was inspected and used as an architectural/visual reference only
(sandboxed preload bridge, Node `http` + Server-Sent Events overlay server, tmp-file + rename persistence,
Bahnschrift/Segoe typography, cyan/magenta palette). No NeonAmp code is imported; NeonAmp is not modified.

## Stack

| Concern | Choice |
|---|---|
| Shell | Electron 45 (Node 22 runtime in main: global `fetch`, global `WebSocket`) |
| Language | TypeScript 5.9 (strict) |
| UI | React 19 (editor + overlay share the same render components) |
| Bundling | Vite 6 (`vite.editor.config.ts`, `vite.overlay.config.ts`), esbuild for main/preload (`scripts/build-main.mjs`) |
| Validation | zod 4 (IPC payloads, documents, imports) |
| Tests | Vitest 3 (`tests/`), plus an Electron `--selftest` end-to-end mode |
| Packaging | electron-builder 26 (NSIS + portable) |

Node used for tooling: 20.10 (Vite 6 / Vitest 3 support it).

## Process & module boundaries

```
src/
  app-config.ts        APP_NAME, APP_ID, DEFAULT_PORT ... (single place to rename the product; also package.json productName/build.productName)
  shared/              Pure TS, no DOM, no Node. Document model, ops, migrations, schema, output filtering, bounds,
                       snapping, timer math, chat types, server<->client protocol types, templates.
  widgets/             First-party widget plugins.
    contract.ts        WidgetDefinition contract (pure) + FieldSpec types
    registry.ts        Pure definitions registry (imported by main, editor, overlay)
    renderers.tsx      kind -> React component map (imported by editor + overlay only, never main)
    <kind>/definition.ts   pure: metadata, fields, defaults, validate, migrate, dataSources, visualOverflow
    <kind>/render.tsx      React component
  render/              Browser-only React renderer shared by editor preview and OBS output:
                       SceneRenderer, NodeView, style helpers, RuntimeContext, client stores (runtime, chat).
  main/                Electron main process (Node). window, validated IPC, persistence, secrets, assets,
                       local HTTP server + SSE hub, live/draft state, runtime state, provider integrations.
  preload/             contextBridge API (`window.neonstage`), narrow, typed, no raw ipcRenderer exposure.
  editor/              React desktop editor (renderer process, sandboxed, no Node).
  overlay/             OBS output entry (plain browser page; EventSource; no Electron APIs).
```

Rules:
- `shared/` and `widgets/**/definition.ts` must not import React, DOM, Node or Electron.
- `main/` never imports React or `*.tsx`.
- `editor/` and `overlay/` never import `main/` or Node modules.
- Editor and overlay both render scenes exclusively through `render/SceneRenderer` + `widgets/renderers.tsx`.

## Document model (`src/shared/model.ts`)

```ts
ProjectDoc { schemaVersion: number; id; name; createdAt; updatedAt; scenes: Scene[]; assets: AssetRef[]; settings: { reduceMotion: boolean } }
Scene      { id; name; width; height; nodes: Record<string, SceneNode>; rootIds: string[] }   // order = back -> front
SceneNode  { id; type: 'widget' | 'group'; name; parentId: string | null; children: string[] (groups only, back->front);
             x; y; w; h;  (absolute scene coordinates, logical px; groups' box = union of children, kept in sync by ops)
             visible; locked; opacity (0..1); style: NodeStyle; widget: { kind; version; props } | null;
             output: { padding: number } }
AssetRef   { id (sha256 hex + '.' + ext); name; mime; size }
```

Inheritance (documented behaviour, implemented in `shared/output.ts`):
- Effective visibility = node.visible AND every ancestor visible. Hidden nodes are removed from output payloads.
- Effective opacity = product of node and ancestor opacities.
- Lock is editor-only; a locked group locks its descendants for pointer editing. Lock never affects output.
- Styles are per widget; groups do not cascade styles (only visibility and opacity inherit).

Scaling vs resizing:
- Resizing a widget changes its logical box; its content reflows (text wraps, chat shows more lines, frames redraw
  their vector paths at the new size). Text size never stretches.
- Scaling a composition is uniform: output pages fit the logical viewport into the browser window with
  `contain` (uniform scale, centered, transparent letterbox). `?fit=none` renders 1:1 from the top-left.

## Shared style (`NodeStyle`)
fontFamily, fontSize, fontWeight, lineHeight, letterSpacing, textAlign, textColor, textOpacity, bgColor, bgOpacity,
bgGradient {enabled,color2,angle}, padding, borderWidth, borderColor, borderOpacity, radius, glowEnabled, glowColor,
glowSize, shadowEnabled, shadowColor, shadowOpacity, shadowX, shadowY, shadowBlur, animate, animationSpeed.
Background opacity is independent of text opacity (colors are emitted as rgba, never via element opacity).
Glow uses box-shadow/text-shadow (no stacked `filter` chains); conservative defaults (glow off or small).

## Widget plugin contract (`src/widgets/contract.ts`)
See `docs/WIDGETS.md` for the full contract. Summary: each widget has metadata, `version`, `fields` (inspector schema),
`styleCapabilities`, `defaultSize`, `defaultProps()`, `validate()` (coerce + fill defaults), `migrate()` (per-widget
version upgrades), `dataSources()` (pure description of provider subscriptions used by the main-process runtime host
for ref-counted shared connections), `visualOverflow()` (for isolated output bounds), optional `runtime` slot type
(`timer` / `goal`), and a separately registered React `render` component that receives `{node, props, style, mode, ctx}`.
Lifecycle: render components clean up timers/subscriptions in effect cleanups; main-side `WidgetRuntimeHost` acquires
data sources when widgets appear in the draft or live document and releases them when they disappear.
No third-party code execution; registry is compiled in.

## Preview / Live
Main holds two documents: `draft` (what the editor edits) and `live` (what outputs render), plus `programSceneId`.
- Editor edits only `draft`. "Publish to OBS" publishes `draft -> live`.
- "Live edit" toggle (off by default) publishes every accepted draft change immediately, and publishes the
  current draft when it is turned on.
- Controller actions (timer start/pause/reset, manual goal value, session clock) are runtime state and apply
  immediately to everything — they are not document edits.
- Project file stores both: `{ format: 'neonstage-project', fileVersion, draft, live, programSceneId, liveEdit }`.

## Runtime state (main-owned, shared by all outputs)
```ts
RuntimeState { timers: Record<nodeId, { running; startedAt: number|null; accumulatedMs }>;
               goals: Record<nodeId, { current: number }>; session: { startedAt: number|null } }
```
Clients compute time from `serverNow` offset sent in snapshots/pings, so N output connections display identical values
and nothing advances per connection. Persisted to `runtime.json`.

## Local server (`src/main/server/`)
Node `http`, bound to `127.0.0.1` on a persisted port (default in `app-config.ts`). If the port is in use the server
does NOT move to another port; status becomes `error` with an actionable message and the user can change the port.
Only `GET`/`HEAD`. Requests whose `Host` header is not `127.0.0.1:<port>`, `localhost:<port>` or `[::1]:<port>` are
rejected (DNS-rebinding protection). No CORS headers. Strict CSP header on HTML.

| Route | Purpose |
|---|---|
| `GET /output/live` | Program scene (live document), full composition. Follows "Set as program scene". |
| `GET /output/scene/:sceneId` | One scene (live document), full composition. |
| `GET /output/scene/:sceneId/object/:nodeId` | One object, tightly bounded transparent viewport. |
| `GET /output/scene/:sceneId/group/:nodeId` | One group, internal arrangement preserved, tightly bounded. |
| `GET /events/<same suffix as /output>` | SSE stream for that target (`/events/live`, `/events/scene/:id`, ...). |
| `GET /static/*` | Overlay bundle (JS/CSS) built by Vite. |
| `GET /media/:assetId` | Managed user asset by content id only (no paths). |
| `GET /health` | `{ ok, app, version }` |

Read-only by design: no route mutates state, exposes credentials, files outside the asset store, or app management.

### Live protocol (SSE, `src/shared/protocol.ts`)
Every new connection receives `snapshot` first: `{ t:'snapshot', serverNow, rev, target, scene: OutputScene|null,
runtime, chat: ChatSnapshot, providers: BroadcastSafeStatus }`. Then incremental messages: `scene`, `runtime`,
`chat` (ops: add/delete/clearUser/clear), `providers`, `ping` (every 15 s, carries serverNow).
`retry: 2000` makes EventSource reconnect automatically; reconnect = fresh snapshot (no replay needed).
`OutputScene` is produced by `buildOutputScene(liveDoc, target)` — hidden nodes removed, editor-only data stripped,
render order flattened, viewport computed (full scene or isolated bounds = union of visible subtree boxes expanded by
each node's visual overflow (glow/shadow/animation) + node `output.padding`).

## Chat
Normalized `ChatMessage { id, sourceKey, platform, demo?, ts, author {id,name,color?,badges[],avatarUrl?}, segments
(text | emote | mention), kind, amountText?, meta (provider-specific) }`. Messages are rendered as React text nodes
only — never as HTML. Emote/badge/avatar URLs are accepted only from allowlisted provider CDNs.
Source keys: `twitch:<login>`, `youtube:<liveChatId-or-mine>`, `demo:twitch`, `demo:youtube`.
Bounded history (200 per source). Chat ops go to a per-source client store; only chat widgets subscribed to that
source re-render (`useSyncExternalStore`).

Providers (`src/main/providers/`): `ProviderManager` ref-counts sources requested by `WidgetRuntimeHost`.
- Twitch: Device Code Grant Flow (public client, user supplies their own Client ID), EventSub WebSocket
  (`wss://eventsub.wss.twitch.tv/ws`), one shared session, subscriptions `channel.chat.message`,
  `channel.chat.message_delete`, `channel.chat.clear`, `channel.chat.clear_user_messages` (v1, scope `user:read:chat`).
- YouTube: OAuth 2.0 installed-app loopback flow with PKCE (user supplies a Desktop OAuth client), scope
  `youtube.readonly`, broadcast resolution via `liveBroadcasts.list` (mine + active) or a video ID via `videos.list`
  `liveStreamingDetails.activeLiveChatId`, messages via `liveChat/messages` polling honoring `pollingIntervalMillis`
  and a user-configurable minimum interval (each call costs 5 quota units; default daily quota 10,000).
- Demo: explicit demo sources generating labelled sample messages. Never reported as a live connection.
Adapters receive `fetch`, a WebSocket factory and timers through their deps so tests run without network, and
call an `onStatusChange` hook that re-emits the manager's `status` event. `ChatAdapter.reconnect()` backs the
Connections "Reconnect" button. Setup, quota math and troubleshooting are in `docs/PROVIDERS.md`.
Credentials: Electron `safeStorage` (DPAPI on Windows) encrypted `secrets.dat` in userData. Never in documents,
exports, SSE payloads, logs or renderer bundles. If OS encryption is unavailable, tokens are kept in memory only.

## Persistence
userData (`%APPDATA%/NeonStage`): `preferences.json`, `projects/<id>.neonstage.json`, `runtime.json`,
`secrets.dat`, `assets/<sha256>.<ext>` + `assets/index.json`.
Atomic writes: write `*.tmp` + fsync, rotate current to `*.bak`, rename tmp -> target. Load tries file, then `.bak`;
unreadable files are preserved as `*.corrupt-<timestamp>` and the user is told. Documents carry `schemaVersion` and are
migrated by `shared/migrations.ts`; widgets carry their own `version` migrated by their definition.
Export: `.neonstage.json` with draft document + embedded assets (base64), run through `stripSecrets`.

## Security
contextIsolation, sandbox, nodeIntegration off, webSecurity on, navigation and window.open blocked, CSP on editor
HTML, IPC sender-frame check + zod validation on every channel, `shell.openExternal` only for allowlisted provider URLs.
