import { app, BrowserWindow, safeStorage, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { APP_NAME, APP_VERSION } from '../app-config';
import { IPC_EVENTS, type ServerStatus, type TwitchAuthPrompt } from '../shared/ipc';
import type { ProjectFile } from '../shared/model';
import { registerIpc } from './ipc';
import { createLogger } from './log';
import { applyDataDirArg, resolvePaths, type AppPaths } from './paths';
import { DemoChatAdapter } from './providers/demo';
import { ProviderManager } from './providers/manager';
import { TwitchChatAdapter } from './providers/twitch';
import { YouTubeChatAdapter } from './providers/youtube';
import { AppState } from './runtime/appState';
import { WidgetRuntimeHost } from './runtime/widgetRuntimeHost';
import { OverlayServer } from './server/httpServer';
import { SseHub } from './server/sseHub';
import { runSelfTest } from './selftest';
import { AssetStore } from './store/assets';
import { PrefsStore } from './store/prefs';
import { ProjectStore } from './store/projectStore';
import { SecretStore } from './store/secrets';
import { createWindow } from './window';

let mainWindow: BrowserWindow | null = null;
let currentPaths: AppPaths | null = null;
let openWindow: (() => void) | null = null;

const isSelfTest = process.argv.includes('--selftest');
const SCREENSHOT_TABS: Record<string, string> = {
  inspector: '',
  controls: 'controls',
  outputs: 'settings=outputs',
  connections: 'settings=connections',
};

function openInitialProject(
  store: ProjectStore,
  prefs: PrefsStore,
  notices: string[],
): ProjectFile {
  const lastId = prefs.get().lastProjectId;
  if (lastId) {
    try {
      const loaded = store.load(lastId);
      notices.push(...loaded.notices);
      return loaded.file;
    } catch {
      notices.push('The last project could not be opened; a new one was created.');
    }
  }

  const existing = store.list();
  if (existing.length > 0) {
    try {
      const loaded = store.load(existing[0]!.id);
      notices.push(...loaded.notices);
      prefs.update({ lastProjectId: loaded.file.draft.id });
      return loaded.file;
    } catch {
      notices.push('A saved project could not be opened; a new one was created.');
    }
  }

  const created = store.create('My First Overlay', 'synthwave-gameplay');
  prefs.update({ lastProjectId: created.file.draft.id });
  return created.file;
}

async function start(): Promise<void> {
  if (isSelfTest) {
    const code = await runSelfTest({ appName: APP_NAME, version: APP_VERSION });
    app.exit(code);
    return;
  }

  const paths = resolvePaths();
  currentPaths = paths;
  const log = createLogger(paths.logs);
  const screenshotArg = process.argv.find((entry) => entry.startsWith('--screenshot='));
  const screenshotPath =
    !app.isPackaged && screenshotArg
      ? path.resolve(screenshotArg.slice('--screenshot='.length).trim())
      : null;
  const tabArg = process.argv.find((entry) => entry.startsWith('--screenshot-tab='));
  const requestedTab = !app.isPackaged && tabArg ? tabArg.slice('--screenshot-tab='.length).trim() : '';
  const screenshotTab = requestedTab in SCREENSHOT_TABS ? SCREENSHOT_TABS[requestedTab]! : null;
  const e2eArg = process.argv.find((entry) => entry.startsWith('--e2e='));
  const e2ePath =
    !app.isPackaged && e2eArg ? path.resolve(e2eArg.slice('--e2e='.length).trim()) : null;

  const notices: string[] = [];
  const prefs = new PrefsStore(paths.userData);
  notices.push(...prefs.takeNotices());

  const secrets = new SecretStore(paths.secretsFile, {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (value) => safeStorage.encryptString(value),
    decrypt: (buffer) => safeStorage.decryptString(buffer),
  });
  const assets = new AssetStore(paths.assets);
  const store = new ProjectStore(paths.projects);

  const file = openInitialProject(store, prefs, notices);
  const appState = new AppState(file, { store, runtimeFile: paths.runtimeFile });

  const providers = new ProviderManager();
  const adapterDeps = {
    secrets,
    log,
    openExternal: (url: string) => shell.openExternal(url),
    onStatusChange: () => providers.notifyStatus(),
    onAuthPrompt: (prompt: TwitchAuthPrompt) => {
      log.info(`Twitch device code issued, expires ${new Date(prompt.expiresAt).toISOString()}`);
      providers.notifyStatus();
    },
  };
  const twitch = new TwitchChatAdapter(adapterDeps);
  const youtube = new YouTubeChatAdapter(adapterDeps);
  providers.registerAdapter('demo-twitch', new DemoChatAdapter('twitch'));
  providers.registerAdapter('demo-youtube', new DemoChatAdapter('youtube'));
  providers.registerAdapter('twitch', twitch);
  providers.registerAdapter('youtube', youtube);

  const runtimeHost = new WidgetRuntimeHost(providers);
  runtimeHost.sync([appState.draft, appState.live]);

  const hub = new SseHub({
    getLiveDoc: () => appState.live,
    getProgramSceneId: () => appState.programSceneId,
    getRuntime: () => appState.runtime,
    getChat: () => appState.chat,
    getBroadcastStatus: () => providers.getBroadcastStatus(),
    now: () => Date.now(),
  });

  const server = new OverlayServer({
    overlayDir: paths.overlayDir,
    hub,
    assets,
    appName: APP_NAME,
    version: APP_VERSION,
  });

  const send = (channel: string, payload: unknown): void => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send(channel, payload);
  };

  const status = await server.start(prefs.get().port);
  log.info(`Local server ${status.state} on port ${status.port}`);

  const setPort = async (port: number): Promise<ServerStatus> => {
    const previous = prefs.get().port;
    prefs.update({ port });
    await server.stop();
    const next = await server.start(port);
    if (next.state === 'running') {
      send(IPC_EVENTS.server, next);
      return next;
    }
    prefs.update({ port: previous });
    const reverted = await server.start(previous);
    send(IPC_EVENTS.server, reverted);
    return next;
  };

  const restartServer = async (): Promise<ServerStatus> => {
    await server.stop();
    const next = await server.start(prefs.get().port);
    send(IPC_EVENTS.server, next);
    return next;
  };

  appState.on('draft', () => {
    runtimeHost.sync([appState.draft, appState.live]);
  });
  appState.on('live', () => {
    runtimeHost.sync([appState.draft, appState.live]);
    hub.docChanged();
  });
  appState.on('meta', (meta) => send(IPC_EVENTS.meta, meta));
  appState.on('runtime', (runtime) => {
    hub.runtimeChanged();
    send(IPC_EVENTS.runtime, { runtime, serverNow: Date.now() });
  });
  providers.on('chat', (ops) => {
    appState.applyChat(ops);
    hub.chatOps(ops);
    send(IPC_EVENTS.chat, ops);
  });
  providers.on('status', (statuses) => {
    hub.providersChanged();
    send(IPC_EVENTS.providers, statuses);
  });

  registerIpc({
    appName: APP_NAME,
    version: APP_VERSION,
    editorIndex: paths.editorIndex,
    paths,
    log,
    prefs,
    store,
    assets,
    secrets,
    appState,
    server,
    hub,
    providers,
    twitch,
    youtube,
    runtimeHost,
    notices,
    getWindow: () => mainWindow,
    setPort,
    restartServer,
  });

  openWindow = () => {
    if (mainWindow) return;
    const win = createWindow({
      preload: paths.preload,
      editorIndex: paths.editorIndex,
      appName: APP_NAME,
      isPackaged: app.isPackaged,
    });
    mainWindow = win;
    win.webContents.on('console-message', (details) => {
      if (details.level !== 'warning' && details.level !== 'error') return;
      const message = `renderer ${details.level}: ${details.message} (${details.sourceId}:${details.lineNumber})`;
      if (details.level === 'error') log.error(message);
      else log.warn(message);
    });
    if (screenshotTab) {
      void win.loadFile(paths.editorIndex, { hash: screenshotTab }).catch(() => undefined);
    }
    if (e2ePath) {
      win.webContents.once('did-finish-load', () => {
        try {
          const runner = require(e2ePath) as (
            win: BrowserWindow,
            app: Electron.App,
          ) => void | Promise<void>;
          void Promise.resolve(runner(win, app)).catch((error: unknown) => {
            log.error('E2E script failed', error);
            app.exit(1);
          });
        } catch (error) {
          log.error('E2E script could not be loaded', error);
          app.exit(1);
        }
      });
    }
    if (screenshotPath) {
      const capture = (): void => {
        setTimeout(() => {
          void (async () => {
            try {
              const image = await win.webContents.capturePage();
              fs.writeFileSync(screenshotPath, image.toPNG());
              log.info(`Screenshot written to ${screenshotPath}`);
            } catch (error) {
              log.error('Screenshot failed', error);
            } finally {
              app.quit();
            }
          })();
        }, 2500);
      };
      const onLoad = (): void => {
        if (screenshotTab && !win.webContents.getURL().endsWith(`#${screenshotTab}`)) return;
        win.webContents.off('did-finish-load', onLoad);
        capture();
      };
      win.webContents.on('did-finish-load', onLoad);
    }
    win.on('closed', () => {
      mainWindow = null;
    });
  };
  openWindow();

  let shuttingDown = false;
  app.on('before-quit', (event) => {
    if (shuttingDown) return;
    shuttingDown = true;
    event.preventDefault();
    void (async () => {
      try {
        appState.flush();
        await server.stop();
        hub.dispose();
        runtimeHost.dispose();
        providers.dispose();
      } catch (error) {
        log.error('Shutdown failed', error);
      }
      app.exit(0);
    })();
  });
}

function bootstrap(): void {
  applyDataDirArg(process.argv);

  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.on('window-all-closed', () => {
    if (isSelfTest) return;
    app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length > 0) return;
    if (currentPaths) openWindow?.();
  });

  app.whenReady().then(() => {
    void start();
  });
}

if (!isSelfTest && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  bootstrap();
}
