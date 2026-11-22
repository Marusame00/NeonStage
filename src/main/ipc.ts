import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import {
  clipboard,
  dialog,
  ipcMain,
  shell,
  type BrowserWindow,
  type IpcMainInvokeEvent,
} from 'electron';
import { PROJECT_FILE_EXT } from '../app-config';
import { DocumentError } from '../shared/errors';
import type { AssetRef } from '../shared/model';
import { parseOutputPath } from '../shared/output';
import {
  BoolArgs,
  CopyTextArgs,
  CreateProjectArgs,
  IdArgs,
  IPC_CHANNELS,
  NoArgs,
  OpenOutputArgs,
  PortArgs,
  ReconnectArgs,
  RenameProjectArgs,
  SessionActionArgs,
  SetGoalArgs,
  TimerActionArgs,
  TwitchConfigureArgs,
  UpdateDraftArgs,
  UpdatePrefsArgs,
  YouTubeConfigureArgs,
  type InitPayload,
  type InitProject,
  type ProviderSettings,
  type ServerStatus,
} from '../shared/ipc';
import type { AppPaths } from './paths';
import type { Logger } from './log';
import type { PrefsStore } from './store/prefs';
import { buildExport, parseImport, type ProjectStore } from './store/projectStore';
import type { AssetStore } from './store/assets';
import type { SecretStore } from './store/secrets';
import type { AppState } from './runtime/appState';
import type { OverlayServer } from './server/httpServer';
import type { SseHub } from './server/sseHub';
import type { ProviderManager } from './providers/manager';
import type { TwitchChatAdapter } from './providers/twitch';
import type { YouTubeChatAdapter } from './providers/youtube';
import type { WidgetRuntimeHost } from './runtime/widgetRuntimeHost';
import { writeFileAtomic } from './store/atomic';

export interface IpcDeps {
  appName: string;
  version: string;
  editorIndex: string;
  paths: AppPaths;
  log: Logger;
  prefs: PrefsStore;
  store: ProjectStore;
  assets: AssetStore;
  secrets: SecretStore;
  appState: AppState;
  server: OverlayServer;
  hub: SseHub;
  providers: ProviderManager;
  twitch: TwitchChatAdapter;
  youtube: YouTubeChatAdapter;
  runtimeHost: WidgetRuntimeHost;
  notices: string[];
  getWindow(): BrowserWindow | null;
  setPort(port: number): Promise<ServerStatus>;
  restartServer(): Promise<ServerStatus>;
}

function normalizeUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname}`.toLowerCase();
  } catch {
    return '';
  }
}

function userMessage(error: unknown): string {
  if (error instanceof DocumentError) return error.message;
  if (error instanceof Error) {
    const message = error.message;
    if (message && message.length <= 300 && !message.includes('\n') && !/\bat\s+\S+\s+\(/.test(message)) {
      return message;
    }
  }
  return 'Something went wrong. Check the NeonStage log for details.';
}

function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim();
  return cleaned.length > 0 ? cleaned.slice(0, 100) : 'NeonStage project';
}

function providerSettings(secrets: SecretStore): ProviderSettings {
  const twitchClientId = secrets.get<string>('twitch.clientId') ?? '';
  const youtubeClientId = secrets.get<string>('youtube.clientId') ?? '';
  const minPollMs = secrets.get<number>('youtube.minPollMs') ?? 5000;
  return {
    twitch: { clientId: twitchClientId },
    youtube: { clientIdSet: youtubeClientId.length > 0, minPollMs },
  };
}

export function registerIpc(deps: IpcDeps): void {
  const editorUrl = normalizeUrl(pathToFileURL(deps.editorIndex).href);

  const authorized = (event: IpcMainInvokeEvent): boolean => {
    try {
      return normalizeUrl(event.senderFrame?.url ?? '') === editorUrl;
    } catch {
      return false;
    }
  };

  function handle<S extends z.ZodTuple, R>(
    channel: string,
    argsSchema: S,
    fn: (args: z.output<S>) => R | Promise<R>,
  ): void {
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      try {
        if (!authorized(event)) return { ok: false, error: 'Unauthorized sender' };
        const parsed = argsSchema.safeParse(args);
        if (!parsed.success) return { ok: false, error: 'Invalid request.' };
        const data = await fn(parsed.data);
        return { ok: true, data };
      } catch (error) {
        deps.log.error(`IPC ${channel} failed`, error);
        return { ok: false, error: userMessage(error) };
      }
    });
  }

  const project = (file: InitProject['file']): InitProject => ({
    projectId: file.draft.id,
    file,
    meta: deps.appState.meta(),
  });

  handle(IPC_CHANNELS.init, NoArgs, (): InitPayload => {
    const file = deps.appState.file;
    return {
      app: { name: deps.appName, version: deps.version },
      prefs: deps.prefs.get(),
      project: project(file),
      projects: deps.store.list(),
      server: deps.server.status,
      runtime: deps.appState.runtime,
      serverNow: Date.now(),
      chat: deps.appState.chat,
      providers: deps.providers.getStatuses(),
      notices: deps.notices,
      secretsPersistent: deps.secrets.isPersistent,
    };
  });

  handle(IPC_CHANNELS.updateDraft, UpdateDraftArgs, ([doc]) => ({
    accepted: deps.appState.updateDraft(doc),
  }));

  handle(IPC_CHANNELS.publish, NoArgs, () => deps.appState.publish());

  handle(IPC_CHANNELS.setLiveEdit, BoolArgs, ([on]) => deps.appState.setLiveEdit(on));

  handle(IPC_CHANNELS.setProgramScene, IdArgs, ([sceneId]) =>
    deps.appState.setProgramScene(sceneId),
  );

  handle(IPC_CHANNELS.listProjects, NoArgs, () => deps.store.list());

  handle(IPC_CHANNELS.openProject, IdArgs, ([id]) => {
    const loaded = deps.store.load(id);
    deps.appState.load(loaded.file);
    deps.prefs.update({ lastProjectId: loaded.file.draft.id });
    return project(loaded.file);
  });

  handle(IPC_CHANNELS.createProject, CreateProjectArgs, ([name, templateId]) => {
    const created = deps.store.create(name, templateId);
    deps.appState.load(created.file);
    deps.prefs.update({ lastProjectId: created.file.draft.id });
    return project(created.file);
  });

  handle(IPC_CHANNELS.renameProject, RenameProjectArgs, ([name]) => {
    const file = deps.store.rename(deps.appState.projectId, name);
    deps.appState.load(file);
    return deps.appState.meta();
  });

  handle(IPC_CHANNELS.deleteProject, IdArgs, async ([id]) => {
    if (id === deps.appState.projectId) {
      throw new Error('Close this project before deleting it.');
    }
    const win = deps.getWindow();
    const options = {
      type: 'warning' as const,
      buttons: ['Delete', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Delete project',
      message: 'Delete this project?',
      detail: 'The project file is moved to the trash folder inside your NeonStage data folder.',
    };
    const result = win
      ? await dialog.showMessageBox(win, options)
      : await dialog.showMessageBox(options);
    if (result.response !== 0) return false;
    return deps.store.delete(id);
  });

  handle(IPC_CHANNELS.exportProject, NoArgs, async () => {
    const file = deps.appState.file;
    const win = deps.getWindow();
    const defaultPath = `${sanitizeFileName(file.draft.name)}${PROJECT_FILE_EXT}`;
    const result = win
      ? await dialog.showSaveDialog(win, {
          title: 'Export project',
          defaultPath,
          filters: [{ name: 'NeonStage project', extensions: ['json'] }],
        })
      : await dialog.showSaveDialog({
          title: 'Export project',
          defaultPath,
          filters: [{ name: 'NeonStage project', extensions: ['json'] }],
        });
    if (result.canceled || !result.filePath) return { saved: false };
    const exported = buildExport(file, deps.assets);
    writeFileAtomic(result.filePath, exported.json);
    return {
      saved: true,
      fileName: path.basename(result.filePath),
      missingAssets: exported.missingAssets,
    };
  });

  handle(IPC_CHANNELS.importProject, NoArgs, async () => {
    const win = deps.getWindow();
    const options = {
      title: 'Import project',
      properties: ['openFile' as const],
      filters: [{ name: 'NeonStage project', extensions: ['json'] }],
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return null;
    const raw = fs.readFileSync(result.filePaths[0]!, 'utf8');
    const imported = parseImport(raw, deps.assets);
    deps.store.save(imported.file);
    deps.appState.load(imported.file);
    deps.prefs.update({ lastProjectId: imported.file.draft.id });
    return project(imported.file);
  });

  handle(IPC_CHANNELS.importAsset, NoArgs, async (): Promise<AssetRef | null> => {
    const win = deps.getWindow();
    const options = {
      title: 'Import image',
      properties: ['openFile' as const],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }],
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return null;
    return deps.assets.importFile(result.filePaths[0]!);
  });

  handle(IPC_CHANNELS.timerAction, TimerActionArgs, ([nodeId, action]) => {
    deps.appState.timerAction(nodeId, action);
  });

  handle(IPC_CHANNELS.setGoal, SetGoalArgs, ([nodeId, value]) => {
    deps.appState.setGoal(nodeId, value);
  });

  handle(IPC_CHANNELS.sessionAction, SessionActionArgs, ([action]) => {
    deps.appState.sessionAction(action);
  });

  handle(IPC_CHANNELS.setPort, PortArgs, ([port]) => deps.setPort(port));

  handle(IPC_CHANNELS.restartServer, NoArgs, () => deps.restartServer());

  handle(IPC_CHANNELS.copyText, CopyTextArgs, ([text]) => {
    clipboard.writeText(text);
  });

  handle(IPC_CHANNELS.openOutputInBrowser, OpenOutputArgs, async ([outputPath]) => {
    if (!parseOutputPath(outputPath, 'output')) {
      throw new Error('That output path is not valid.');
    }
    const status = deps.server.status;
    if (status.state !== 'running' || !status.baseUrl) {
      throw new Error('The local server is not running.');
    }
    await shell.openExternal(`${status.baseUrl}${outputPath}`);
  });

  handle(IPC_CHANNELS.revealDataFolder, NoArgs, async () => {
    await shell.openPath(deps.paths.userData);
  });

  handle(IPC_CHANNELS.updatePrefs, UpdatePrefsArgs, ([patch]) => deps.prefs.update(patch));

  handle(IPC_CHANNELS.providersGetStatus, NoArgs, () => deps.providers.getStatuses());

  handle(IPC_CHANNELS.providersGetSettings, NoArgs, () => providerSettings(deps.secrets));

  handle(IPC_CHANNELS.twitchConfigure, TwitchConfigureArgs, async ([cfg]) => {
    await deps.twitch.configure(cfg.clientId);
    return providerSettings(deps.secrets);
  });

  handle(IPC_CHANNELS.twitchStartAuth, NoArgs, () => deps.twitch.startAuth());

  handle(IPC_CHANNELS.twitchCancelAuth, NoArgs, () => {
    deps.twitch.cancelAuth();
  });

  handle(IPC_CHANNELS.twitchSignOut, NoArgs, () => deps.twitch.signOut());

  handle(IPC_CHANNELS.youtubeConfigure, YouTubeConfigureArgs, async ([cfg]) => {
    await deps.youtube.configure(cfg.clientId, cfg.clientSecret, cfg.minPollMs);
    return providerSettings(deps.secrets);
  });

  handle(IPC_CHANNELS.youtubeStartAuth, NoArgs, () => deps.youtube.startAuth());

  handle(IPC_CHANNELS.youtubeCancelAuth, NoArgs, () => {
    deps.youtube.cancelAuth();
  });

  handle(IPC_CHANNELS.youtubeSignOut, NoArgs, () => deps.youtube.signOut());

  handle(IPC_CHANNELS.youtubeListBroadcasts, NoArgs, () => deps.youtube.listBroadcasts());

  handle(IPC_CHANNELS.reconnect, ReconnectArgs, async ([provider]) => {
    const adapter = provider === 'twitch' ? deps.twitch : deps.youtube;
    if (!adapter.reconnect) throw new Error('Reconnect is not available.');
    await adapter.reconnect();
  });
}
