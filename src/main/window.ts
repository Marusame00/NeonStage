import { BrowserWindow, Menu, session, shell } from 'electron';

const EXTERNAL_HOSTS = new Set([
  'id.twitch.tv',
  'www.twitch.tv',
  'dev.twitch.tv',
  'accounts.google.com',
  'console.cloud.google.com',
  'developers.google.com',
  'obsproject.com',
]);

export interface WindowOptions {
  preload: string;
  editorIndex: string;
  appName: string;
  isPackaged: boolean;
}

export function createWindow(options: WindowOptions): BrowserWindow {
  Menu.setApplicationMenu(null);
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#0c0a14',
    title: options.appName,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0e0a18', symbolColor: '#d9d2f5', height: 36 },
    webPreferences: {
      preload: options.preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      backgroundThrottling: false,
      devTools: !options.isPackaged,
    },
  });

  win.once('ready-to-show', () => win.show());

  win.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:' && EXTERNAL_HOSTS.has(parsed.hostname.toLowerCase())) {
        void shell.openExternal(url);
      }
    } catch {
      return { action: 'deny' };
    }
    return { action: 'deny' };
  });

  if (!options.isPackaged) {
    win.webContents.on('before-input-event', (event, input) => {
      if (
        input.type === 'keyDown' &&
        input.control &&
        input.shift &&
        input.key.toLowerCase() === 'i'
      ) {
        win.webContents.toggleDevTools();
        event.preventDefault();
      }
    });
  }

  void win.loadFile(options.editorIndex);
  return win;
}
