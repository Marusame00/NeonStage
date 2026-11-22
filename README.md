# NeonStage

NeonStage is a Windows desktop app for designing and controlling transparent overlays for OBS Studio.
You build scenes in the NeonStage editor; OBS loads a clean, transparent output page that the running
app serves on loopback (`http://127.0.0.1:8790` by default). Nothing is uploaded and there is no
NeonStage account or relay server.

- Editor: scenes, groups, layers, inspector, undo/redo, preview and live documents.
- Output: one Browser Source for the whole composition, or one per scene, group or object.
- Widgets: text, shape, frame, timer, clock, goal, ticker, image, Twitch chat, YouTube chat, combined chat.
- Chat: Twitch chat with just a channel name (anonymous, read-only) or your own Twitch app; YouTube with
  your own Google credentials; read-only scopes, tokens encrypted with the OS keystore.

## Download

Get the latest build from the [Releases page](https://github.com/Marusame00/NeonStage/releases):

| File | Use it when |
|---|---|
| `NeonStage-1.0.0-Setup.exe` | You want a normal install with Start menu and desktop shortcuts. |
| `NeonStage-1.0.0-Portable.exe` | You want a single exe that runs without installing (data still goes to `%APPDATA%\NeonStage`). |

The builds are not code-signed, so Windows SmartScreen may show "Windows protected your PC". Click
**More info → Run anyway**.

## Quick start

1. Start NeonStage and pick a template or add widgets from the Library on the left.
2. Arrange them on the canvas; the Inspector on the right edits the selected layer.
3. For Twitch chat, add a **Twitch chat** widget and type the channel name. No account needed.
4. Click **Publish to OBS** to send your changes to the overlay (or turn on **Live edit** to publish
   every change immediately).
5. Open **Settings (gear) → OBS output**, copy the URL (default `http://127.0.0.1:8790/output/live`).
6. In OBS add a **Browser** source, paste the URL, set width 1920 and height 1080.
7. Keep NeonStage running while you stream.

Details: [docs/OBS_SETUP.md](docs/OBS_SETUP.md) and [docs/PROVIDERS.md](docs/PROVIDERS.md).

# Building from source

## Requirements

- Windows 10 or Windows 11 (x64).
- Node 20.10 or newer for development. The toolchain in this repository was verified on Node 20.10;
  Node 22 LTS is recommended. Electron 45 bundles Node 22 inside the app, so the packaged build does
  not need Node installed.
- OBS Studio (any recent version) for the actual stream overlay.

## Install and run

```bat
npm install
npm start
```

`npm start` runs the full build (typecheck, main/preload bundle, editor bundle, overlay bundle) and then
launches Electron. `Start NeonStage.bat` in the repository root does the same thing from Explorer.

`npm run dev` runs the three build steps without the typecheck and then launches Electron
(`scripts/dev.mjs`). It does not watch files; re-run it after a change.

## Tests

```bat
npm test          :: Vitest unit and integration tests (163 tests in 20 files)
npm run selftest  :: Electron end-to-end self-test (14 checks, exit code 0 only if all pass)
```

`npm run selftest` runs `electron . --selftest`. It starts the real stack (stores, AppState,
ProviderManager, OverlayServer) against a fresh temporary data directory on a free port, drives real
output pages in hidden offscreen windows, prints `PASS <name>` / `FAIL <name>: <reason>` per check plus
a summary, writes the same lines to `<temp>/selftest.log`, and exits with 0 only when every check
passes. It never opens the editor window and never touches your real data directory.

Optional flags: `--selftest-port=<port>` to bind a specific port instead of an ephemeral one.

## Build and packaging

```bat
npm run build      :: typecheck + main + editor + overlay bundles into dist/
npm run dist:dir   :: build + unpacked app in release/win-unpacked/ (fast, no installer)
npm run dist       :: build + NSIS installer and portable exe in release/
```

Packaging uses electron-builder with the `build` key in `package.json`:

| Setting | Value |
|---|---|
| appId | `com.neonstage.app` |
| productName | `NeonStage` (from `package.json`) |
| asar | `true` (`release/win-unpacked/resources/app.asar`) |
| output | `release/` |
| buildResources | `build/` |
| files | `dist/**/*`, `package.json` |
| win targets | `nsis` and `portable`, x64 |
| installer | not one-click, installation directory selectable, desktop shortcut |
| artifact names | `NeonStage-<version>-Setup.exe`, `NeonStage-<version>-Portable.exe` |

`release/` is git-ignored. The packaged app resolves its bundles through `app.getAppPath()`
(`src/main/paths.ts`), so `dist/` inside `app.asar` is used unchanged.

The packaged app supports `--selftest` too:

```bat
release\win-unpacked\NeonStage.exe --selftest
```

Development-only flags `--screenshot=<file>` and `--screenshot-tab=<tab>` are ignored when the app is
packaged. `--data-dir=<path>` is honoured in both cases, which is what the portable build uses to keep
its data next to the executable if you want that.

## Data location

Everything lives in `%APPDATA%\NeonStage` unless you pass `--data-dir=<path>`:

```
preferences.json          port, last project, editor preferences
projects\<id>.neonstage.json   draft + live documents, program scene, live-edit flag
runtime.json              timers, goals, session clock
secrets.dat               OS-encrypted provider tokens (DPAPI on Windows)
assets\<sha256>.<ext>     imported images, addressed by content id
logs\main.log             rotating main-process log (no tokens)
```

Writes are atomic (temp file + fsync + rename) and the previous version is kept as `*.bak`, so a damaged
file is recovered from its backup with a notice in the editor.

## Keep the app running while streaming

OBS loads the overlay from the NeonStage local server. If NeonStage exits, the Browser Source goes
blank. Leave it running for the whole stream; closing the editor window quits the app.

If the configured port is already taken, NeonStage reports an error instead of silently moving to
another port, because your OBS Browser Sources point at that port. Change the port in
**Settings → OBS output → Local server** and update the URLs in OBS.

## Renaming the app

The product name lives in three places:

1. `src/app-config.ts` — `APP_NAME`, `APP_ID`, `DEFAULT_PORT`, `APP_VERSION`.
2. `package.json` — `name`, `productName`, `build.appId`, `build.productName`.
3. `docs/` — the titles and prose in `README.md`, `docs/ARCHITECTURE.md`, `docs/OBS_SETUP.md`,
   `docs/OUTPUT_ROUTES.md`, `docs/WIDGETS.md`, `docs/STATUS.md`.

`APP_NAME` is used for the window title, `/health`, the export header and log lines; `productName` and
`appId` drive the installer, the executable name and the `%APPDATA%` folder.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — stack, module boundaries, document model, protocol.
- [docs/OBS_SETUP.md](docs/OBS_SETUP.md) — plain-language OBS setup, preview vs live, troubleshooting.
- [docs/OUTPUT_ROUTES.md](docs/OUTPUT_ROUTES.md) — every server route, parameters and bounds rules.
- [docs/WIDGETS.md](docs/WIDGETS.md) — the widget contract and how to add a widget.
- [docs/PROVIDERS.md](docs/PROVIDERS.md) — Twitch and YouTube setup, scopes, quota, troubleshooting.
- [docs/STATUS.md](docs/STATUS.md) — what is implemented, tested, verified, untested and deferred.

## License

MIT — see [LICENSE](LICENSE).
