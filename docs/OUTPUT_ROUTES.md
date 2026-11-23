# NeonStage — Output routes

The local server is Node `http`, bound to `127.0.0.1` only, on the port stored in preferences
(default `8790`). It is read-only: no route mutates state, exposes credentials, reads files outside the
asset store, or manages the app.

## Request rules

| Rule | Behaviour |
|---|---|
| Methods | `GET` and `HEAD` only. Anything else returns `405 Method Not Allowed`. |
| Host header | Must be `127.0.0.1:<port>`, `localhost:<port>` or `[::1]:<port>`. Otherwise `403 Forbidden` (DNS-rebinding protection). |
| CORS | No `Access-Control-Allow-Origin` header is ever sent. |
| Unknown paths | `404 Not found`. |
| Errors | `500 Internal error` with a plain-text body; no stack traces. |

## Routes

### `GET /`

Plain text: `NeonStage is running.` plus the program output path. Useful as a quick "is it up" check.

### `GET /health`

`application/json`:

```json
{ "ok": true, "app": "NeonStage", "version": "1.3.0" }
```

### `GET /output/live`

The output page for the program scene of the live document. This is the single Browser Source URL for a
normal setup. Follows **Set as program scene**.

### `GET /output/scene/:sceneId`

The output page for one scene of the live document, full composition.

### `GET /output/scene/:sceneId/object/:nodeId`

The output page for one object, tightly bounded. `:nodeId` may point at a group; the subtree is rendered
either way.

### `GET /output/scene/:sceneId/group/:nodeId`

The output page for one group, with the internal arrangement preserved and tightly bounded.

All four output routes return the same built `dist/overlay/index.html`; the page reads its target from
`location.pathname` and opens the matching event stream. Headers:

```
Content-Type: text/html; charset=utf-8
Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline';
  img-src 'self' data: https://static-cdn.jtvnw.net https://yt3.ggpht.com https://yt4.ggpht.com
  https://lh3.googleusercontent.com; font-src 'self' data:; connect-src 'self'; base-uri 'none';
  form-action 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Cache-Control: no-store
```

`frame-ancestors` is deliberately not set: OBS loads the page as a top-level document, and a restrictive
value would only break embedding in a preview tool.

Query parameter `?fit=none` renders 1:1 from the top-left instead of scaling to fit (`contain` is the
default).

### `GET /events/live`, `/events/scene/:sceneId`, `/events/scene/:sceneId/object/:nodeId`, `/events/scene/:sceneId/group/:nodeId`

Server-Sent Events stream for the same target as the matching `/output/...` route. `HEAD` returns `200`
with the event-stream headers and no body. Headers:

```
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```

The stream starts with `retry: 2000`, so `EventSource` reconnects by itself. Every new connection
receives a full `snapshot` first:

```ts
{ t: 'snapshot', serverNow, rev, target, scene: OutputScene | null, runtime, chat, providers }
```

Then incremental messages: `scene` (whole scene replaced), `runtime`, `chat` (ops), `providers`, and
`ping` every 15 s carrying `serverNow`. Reconnect is always a fresh snapshot; nothing is replayed.

At most 64 concurrent event streams are served. Beyond that the server answers `503 Too many output
connections` instead of accepting the stream.

### `GET /static/*`

The overlay bundle built by Vite (`dist/overlay`). Path traversal (`..`, encoded `..`, backslashes,
NUL) is rejected with `400`. Files are served with a long-lived immutable cache header and a
`Content-Type` derived from the extension (`text/javascript`, `text/css`, `image/svg+xml`,
`font/woff2`, `image/png`, `application/json`, `text/html`).

### `GET /media/:assetId`

A managed user asset, addressed by content id only (`<sha256>.<ext>`). Anything that is not a valid
content id, or that is not in the asset store, returns `404`. No filesystem path is accepted. Headers
include `Content-Security-Policy: sandbox; default-src 'none'; style-src 'unsafe-inline'` and
`X-Content-Type-Options: nosniff`.

## What the output payload contains

`buildOutputScene(liveDoc, programSceneId, target)` produces:

```ts
OutputScene {
  sceneId; width; height; viewport: { x, y, w, h }; nodes: OutputNode[]; reduceMotion: boolean
}
OutputNode {
  id; parentId; type: 'widget'; x; y; w; h; opacity; style; widget; depth
}
```

- Only widget nodes are emitted; groups exist for arrangement and bounds, not as renderable nodes.
- Nodes are flattened in render order (back to front) with `depth` = number of ancestors.
- Coordinates are relative to `viewport`.
- Editor-only data (selection, locks, names, guides, placeholders) never reaches the payload.
- `reduceMotion` comes from the project setting `settings.reduceMotion`.

## Inherited visibility and opacity

- **Visibility** is the node's own `visible` AND every ancestor's `visible`. A hidden group hides its
  whole subtree; hidden nodes are removed from the payload entirely.
- **Opacity** is the product of the node's `opacity` and every ancestor's `opacity`, clamped to 0..1.
- **Lock** is editor-only. It never affects output.
- **Styles** are per widget. Groups do not cascade styles; only visibility and opacity inherit.

## Isolated output bounds

For `object` and `group` targets the viewport is computed, not stored:

1. Take every effectively visible widget in the subtree (for an object target, the node itself).
2. Expand each rect by that node's visual overflow:
   `max(glowSize * 1.5 when glow is on, max(|shadowX|, |shadowY|) + shadowBlur when shadow is on)`
   plus the widget's own `visualOverflow()` (for example a frame's stroke width), rounded up.
3. Union those rects.
4. Expand the union by the root node's `output.padding`.
5. Floor the left/top and ceil the right/bottom, so the viewport is whole pixels.

If nothing in the subtree is visible, the viewport falls back to the root node's own rect expanded by
its padding, and the payload contains no nodes. Transparent placeholders (frame interiors, empty image
slots, demo chat hidden in output) contribute no pixels and no extra bounds.

`recommendedSize(outputScene)` returns `viewport.w` × `viewport.h`, which is the size to use for that
Browser Source in OBS.
