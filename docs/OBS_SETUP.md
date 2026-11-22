# NeonStage — OBS setup

This guide is for setting up OBS. It assumes NeonStage is installed and running.

## One Browser Source for everything

1. Start NeonStage and leave it running.
2. In OBS open **Sources** and click **+** → **Browser**.
3. Uncheck **Local file**.
4. URL: `http://127.0.0.1:8790/output/live`
5. Width `1920`, Height `1080` (match your canvas).
6. Leave **Custom CSS** empty.
7. Turn **Shutdown source when not visible** off, so chat history survives scene switches.
8. Put your **Game Capture** or **Video Capture** source *below* the Browser Source.

`/output/live` always shows whichever scene is the program scene, so you can switch scenes inside
NeonStage without touching OBS. The page is transparent and scales the composition to fit the source
(uniform scale, centred, transparent letterbox).

## Preview, Publish to OBS and Live edit

NeonStage keeps two documents:

- **Draft** — what the editor edits.
- **Live** — what OBS renders.

**Publish to OBS** copies the draft to live. Until you do that, OBS keeps showing the previous live
version, which is what you want while you are mid-edit during a stream.

**Live edit** (off by default) publishes every accepted draft change immediately, and publishes the
current draft as soon as you turn it on. Use it when you are building the overlay live and want OBS to
follow along.

Controller actions — timer start/pause/reset, manual goal value, session clock — are runtime state, not
document edits. They apply to OBS immediately, whatever the live-edit setting is.

## Per-object and per-group sources

Every object and group has its own URL in **Settings → OBS output → Selected object or group**:

```
http://127.0.0.1:8790/output/scene/<sceneId>/object/<nodeId>
http://127.0.0.1:8790/output/scene/<sceneId>/group/<nodeId>
```

The page is sized to the object or group bounds, including glow/shadow bleed and the node's
**Output padding**. Use the recommended size shown next to the URL as the Browser Source size.

## Game and webcam frames are decorations

The **Frame** widget draws a border, corner brackets, a label and — in the editor only — a hatched
placeholder that says `GAME CAPTURE AREA`. The interior is transparent in OBS. Put your real Game
Capture or Video Capture source underneath the Browser Source and the frame sits on top of it.

## Front and background split

A single Browser Source is one layer in OBS: everything inside it is either above or below your capture
source. If part of the overlay must sit *behind* the game and part in front:

1. Put the background widgets in one group (for example `Background`).
2. Put the foreground widgets in another group (for example `Front`).
3. Add two Browser Sources, one per group URL.
4. Order them in OBS as `Background` → Game Capture → `Front`.

## Scaling

By default the composition is scaled to fit the Browser Source with `contain`. Add `?fit=none` to the
URL to render 1:1 from the top-left corner and let OBS crop:

```
http://127.0.0.1:8790/output/live?fit=none
```

## Port conflicts

NeonStage does not change ports on its own. If the port is in use, the app shows an error in
**Settings → OBS output → Local server** and keeps the previous port. To move:

1. Change the port in **Settings → OBS output → Local server** and press **Apply**.
2. Update the URL in every OBS Browser Source to the new port.

The default port is `8790` (`DEFAULT_PORT` in `src/app-config.ts`).

## Troubleshooting

| Symptom | Check |
|---|---|
| Browser Source is blank | Is NeonStage still running? Does the URL match the port shown in Settings → OBS output? Open the URL in a normal browser — you should see the overlay on a transparent page. |
| Blank after a port change | Update the URL in OBS; the old port is no longer served. |
| Overlay is cut off or letterboxed | The source size does not match the scene aspect. Use the recommended size, or add `?fit=none`. |
| Chat widget shows nothing | Open **Settings → Connections**, make sure the provider is connected and the channel/video is correct. Demo chat is hidden in OBS by default — enable **Show demo messages in output** on the widget if you want it while testing. |
| Chat shows "Waiting for … chat" | The source is not live yet. The widget follows its **When unavailable** setting. |
| Overlay shows the previous layout | You are still in preview. Press **Publish to OBS**, or turn on **Live edit**. |
| Frames look empty | That is correct: the placeholder is editor-only. Put your capture source below the Browser Source. |
| Timer or goal does not move | Timers and goals are runtime state. Start the timer or set the goal in the **Controls** drawer. |
| OBS source reloads on its own | The app restarted or the port changed. EventSource reconnects automatically once the server is back on the same port. |
