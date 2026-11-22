# NeonStage — Widgets and the plugin contract

A widget is a compiled-in plugin: a pure definition (`definition.ts`) plus a React renderer
(`render.tsx`). The definition is imported by the main process, the editor and the overlay; the renderer
is imported by the editor and the overlay only. `main/` never imports React.

```
src/widgets/
  contract.ts        WidgetDefinition, FieldSpec, DataSourceRequest, StyleCapability
  registry.ts        kind -> definition (pure, imported everywhere)
  renderers.tsx      kind -> React component (editor + overlay only)
  render-contract.ts WidgetRenderProps
  fields.ts          zod field helpers used by definitions
  <kind>/definition.ts
  <kind>/render.tsx
```

## Definition contract

`src/widgets/contract.ts`:

```ts
export interface WidgetDefinition<P extends Record<string, unknown> = Record<string, unknown>> {
  kind: string;
  version: number;
  name: string;
  description: string;
  category: WidgetCategory;
  icon: string;
  defaultSize: { w: number; h: number };
  minSize?: { w: number; h: number };
  defaultProps(): P;
  defaultStyle?(): Partial<NodeStyle>;
  fields: FieldSpec[];
  styleCapabilities: StyleCapability[];
  validate(raw: unknown): P;
  migrate?(props: Record<string, unknown>, fromVersion: number): Record<string, unknown>;
  dataSources?(props: P): DataSourceRequest[];
  visualOverflow?(props: P, style: NodeStyle): number;
  runtime?: 'timer' | 'goal';
  manualLabel?: boolean;
  notes?: string[];
}
```

| Member | Meaning |
|---|---|
| `kind` | Stable id stored in documents. Never rename it; add a migration instead. |
| `version` | Per-widget schema version stored in `WidgetInstance.version`. |
| `name`, `description`, `category`, `icon` | Library panel metadata. `icon` is an SVG path string. |
| `defaultSize`, `minSize` | Logical pixels. `minSize` also clamps resizing. |
| `defaultProps()` | Fresh props for a new instance. |
| `defaultStyle()` | Optional style overrides merged over `defaultStyle()` from `shared/model.ts`. |
| `fields` | Inspector schema, rendered by `editor/components/Inspector`. |
| `styleCapabilities` | Which style sections the inspector shows and which style properties the renderer applies. |
| `validate(raw)` | Coerce unknown input into valid props, filling defaults. Called on load, on edit and on every render. |
| `migrate(props, fromVersion)` | Upgrade props written by an older `version`. |
| `dataSources(props)` | Pure description of provider subscriptions; used by the main-process runtime host. |
| `visualOverflow(props, style)` | Extra pixels the widget paints outside its box (used for isolated output bounds). |
| `runtime` | `'timer'` or `'goal'` when the widget reads shared runtime state. |
| `manualLabel` | Marks widgets whose value is set by hand (the goal bar). |
| `notes` | Short editor-facing notes. |

`WidgetCategory` is one of `text`, `shape`, `frame`, `time`, `progress`, `chat`, `info`, `media`.
`StyleCapability` is one of `font`, `text`, `background`, `border`, `radius`, `padding`, `glow`,
`shadow`, `animation`.

### FieldSpec

```ts
type FieldSpec = {
  key: string;
  label: string;
  help?: string;
  section?: string;
  showIf?: { key: string; equals: unknown | unknown[] };
} & (
  | { type: 'text'; placeholder?: string; maxLength?: number }
  | { type: 'textarea'; maxLength?: number }
  | { type: 'number'; min?: number; max?: number; step?: number; unit?: string }
  | { type: 'boolean' }
  | { type: 'select'; options: { value: string; label: string }[] }
  | { type: 'color' }
  | { type: 'stringList'; itemLabel: string; maxItems?: number }
  | { type: 'duration' }
  | { type: 'asset'; accept: 'image' }
);
```

`makeValidator(defaults, shape)` in `contract.ts` builds a `validate` from zod field helpers: every key
of `defaults` is parsed with its schema and falls back to the default when parsing fails.

### DataSourceRequest

```ts
type DataSourceRequest = {
  kind: 'chat';
  provider: 'twitch' | 'youtube' | 'demo-twitch' | 'demo-youtube';
  key: string;
  params: Record<string, string>;
};
```

Keys are the sharing unit: `twitch:<login>`, `youtube:mine`, `youtube:video:<id>`, `demo:twitch`,
`demo:youtube`. Two widgets that return the same key share one provider connection.

## Render contract

```ts
export interface WidgetRenderProps<P extends Record<string, unknown> = Record<string, unknown>> {
  node: OutputNode;
  props: P;
  style: NodeStyle;
  mode: 'editor' | 'output';
  width: number;
  height: number;
}
```

- `node` is the output node (id, box, opacity, depth, widget instance).
- `props` is already validated.
- `mode` is `'editor'` for the canvas preview and `'output'` for the OBS page. Editor-only decoration
  (frame placeholders, demo-data tags, "waiting for chat" captions) must be gated on `mode`.
- `width`/`height` are the logical box; content reflows, text never stretches.

Renderers are registered in `src/widgets/renderers.tsx` and rendered by `render/NodeView.tsx`, which
applies the box, opacity and style, and skips unknown widgets in output mode (no error text ever reaches
OBS).

## Runtime lifecycle

`src/main/runtime/widgetRuntimeHost.ts` owns provider subscriptions for the whole app:

1. On every draft or live change, `WidgetRuntimeHost.sync([draft, live])` collects the union of
   `dataSources()` requests from all widget nodes in both documents.
2. Keys that disappeared are released; new keys are acquired with `ProviderManager.acquire(request)`.
3. `ProviderManager` ref-counts by key: the first acquire calls `adapter.start(request, sink)`, later
   acquires only increment the count. The last release calls `adapter.stop(key)` and emits a
   `clear` chat op.
4. `dispose()` releases everything (app shutdown).

Timers, goals and the session clock are runtime state owned by `AppState`, not by widgets. Widgets with
`runtime: 'timer' | 'goal'` read it through `useRuntime()` and compute elapsed time from `serverNow`, so
every output connection shows the same value and nothing advances per connection.

Chat widgets subscribe per source key through `useChatSources(keys)` / `useSourceStatus(keys)`, which use
`useSyncExternalStore` on the client chat and status stores. Only widgets subscribed to a key re-render
when that key changes.

## Cleanup and disposal

- Renderers clean up timers, intervals, observers and listeners in effect cleanups. The shared
  `FitStage` removes its `resize` listener and disconnects its `ResizeObserver`; chat rows are pure
  renders.
- The overlay page closes its `EventSource` when the component unmounts.
- Main-side, `WidgetRuntimeHost.dispose()` releases every subscription and `ProviderManager.dispose()`
  stops every adapter and clears its entries.
- The SSE hub drops a client as soon as its response closes, and caps buffered bytes per client.

## Versioning and migrations

Two independent versions:

- **Document**: `ProjectDoc.schemaVersion` (currently `1`), migrated by `shared/migrations.ts`
  (`migrateProjectDoc`). A document from a newer schema is rejected with an actionable message.
- **Widget**: `WidgetInstance.version` per instance, migrated by `migrateWidget(instance)` using the
  definition's `migrate()` and then `validate()`. `repairScene` applies it while loading.

To change a widget's props: bump `version`, keep `validate()` able to read the new shape, and add
`migrate(props, fromVersion)` that maps old props to new ones. Never change `kind`.

## Adding a first-party widget

1. Create `src/widgets/<kind>/definition.ts` exporting a `WidgetDefinition<P>`: metadata, `version: 1`,
   `defaultSize`, `defaultProps()`, `fields`, `styleCapabilities`, `validate` (via `makeValidator`), and
   `dataSources` / `visualOverflow` / `runtime` only if the widget needs them.
2. Create `src/widgets/<kind>/render.tsx` exporting a component typed
   `WidgetRenderProps<YourProps>`. Gate editor-only decoration on `mode === 'editor'`. Use
   `useRenderContext()` for `reduceMotion` and `mediaUrl`, and `useRuntime()` / `useChatSources()` for
   shared state.
3. Register the definition in the list at the bottom of `src/widgets/registry.ts`.
4. Register the renderer in the map in `src/widgets/renderers.tsx`.
5. Add tests: definition validation/defaults in `tests/`, rendering in `tests/render.test.tsx`, and
   output bounds in `tests/output.test.ts` if the widget paints outside its box.
6. Run `npm run typecheck`, `npm test`, `npm run build`, `npm run selftest`.

No main-process change is needed unless the widget introduces a new data source provider.

## Built-in widgets

| Kind | Name | Notes |
|---|---|---|
| `text` | Text | Wrapping, vertical alignment, uppercase. |
| `shape` | Shape | Inline SVG: rect, ellipse, line, divider, chevrons, corner brackets, grid, sun. |
| `frame` | Frame | Game/webcam decoration. Transparent interior; the hatched `GAME CAPTURE AREA` placeholder and the "Editor only" caption are editor-only. Contributes its stroke width to `visualOverflow`. |
| `timer` | Timer | Countdown or elapsed, driven by shared runtime state (`runtime: 'timer'`). |
| `clock` | Clock | Local time or session elapsed. |
| `goal` | Goal | Manually controlled progress bar (`runtime: 'goal'`, `manualLabel: true`). Not connected to donations, subs or followers — set the value in **Controls**. |
| `ticker` | Ticker | Scrolling or rotating announcements. |
| `image` | Image | User asset served from the asset store by content id only. |
| `chat-twitch` | Twitch chat | Demo or live channel. Demo mode is labelled and hidden in output unless **Show demo messages in output** is on. |
| `chat-youtube` | YouTube chat | Demo, active broadcast or a specific video id. |
| `chat-combined` | Combined chat | Twitch and YouTube merged, sorted by timestamp. |

Chat widgets share the display fields in `src/widgets/chat/common.ts` (`maxMessages`, timestamps,
badges, emotes, user colours, fade, gap, direction, `onUnavailable`, `showDemoInOutput`, bubble) and the
**Message area** insets (`areaTop`, `areaRight`, `areaBottom`, `areaLeft`, 0–4000 px). The insets move the
message list inside the chat window without moving the window itself, so the text can sit inside a
decorative frame. They can be typed in the Inspector; when a single chat widget is selected the canvas
also shows a dashed "Messages" box with handles for them. `onUnavailable` defaults to `hide`.

The node's padding and border are applied inside its box: the widget renderer receives the node size
minus padding and border on each side, so content no longer overflows a bordered or padded chat.

## Templates

`src/shared/templates.ts` ships four templates:

| Id | Name | Chat layout |
|---|---|---|
| `synthwave-gameplay` (default) | Synthwave gameplay | One full-height Twitch chat on the right. |
| `synthwave-dual-chat` | Synthwave gameplay (Twitch + YouTube) | Same layout plus a YouTube chat at the same position, hidden by default. |
| `minimal-mono` | Minimal mono | No chat widget. |
| `colorful-just-chatting` | Colorful just chatting | Twitch and YouTube chats stacked on the left. |

## Why third-party code execution is deferred

The registry is compiled in. There is no loader for external widget code, no sandbox for it, no signing
or permission model, and no marketplace. Running arbitrary third-party code inside the overlay page
would mean giving it the same origin as the output server and the same access to chat data, so it is
deliberately out of scope for now. A future plugin system would need a separate sandboxed document, a
declared capability list and a review path before it could ship.
