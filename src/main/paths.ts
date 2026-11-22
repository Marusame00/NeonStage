import { app } from 'electron';
import path from 'node:path';

export interface AppPaths {
  userData: string;
  projects: string;
  assets: string;
  logs: string;
  prefsFile: string;
  runtimeFile: string;
  secretsFile: string;
  editorIndex: string;
  overlayDir: string;
  preload: string;
}

export function applyDataDirArg(argv: string[]): string | null {
  const arg = argv.find((entry) => entry.startsWith('--data-dir='));
  if (!arg) return null;
  const value = arg.slice('--data-dir='.length).trim();
  if (!value) return null;
  const resolved = path.resolve(value);
  app.setPath('userData', resolved);
  return resolved;
}

export function resolvePaths(): AppPaths {
  const userData = app.getPath('userData');
  const appPath = app.getAppPath();
  return {
    userData,
    projects: path.join(userData, 'projects'),
    assets: path.join(userData, 'assets'),
    logs: path.join(userData, 'logs'),
    prefsFile: path.join(userData, 'preferences.json'),
    runtimeFile: path.join(userData, 'runtime.json'),
    secretsFile: path.join(userData, 'secrets.dat'),
    editorIndex: path.join(appPath, 'dist', 'editor', 'index.html'),
    overlayDir: path.join(appPath, 'dist', 'overlay'),
    preload: path.join(appPath, 'dist', 'preload', 'preload.js'),
  };
}
