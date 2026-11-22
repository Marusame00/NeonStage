import { z } from 'zod';
import type { AssetRef, ProjectDoc, ProjectFile } from './model';
import type { ChatOp, ChatSnapshot, ProviderStatus } from './chat';
import type { RuntimeState } from './runtime';

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
}

export interface ServerStatus {
  state: 'starting' | 'running' | 'error' | 'stopped';
  port: number;
  baseUrl: string | null;
  message?: string;
}

export interface Preferences {
  port: number;
  lastProjectId: string | null;
  editor: { snap: boolean; gridSize: number; showGrid: boolean; showGuides: boolean };
}

export interface ProjectMeta {
  projectId: string;
  name: string;
  saveState: 'saved' | 'saving' | 'error';
  lastSavedAt: number | null;
  error?: string;
  liveDiffers: boolean;
  liveEdit: boolean;
  programSceneId: string;
  liveRev: number;
}

export interface InitProject {
  projectId: string;
  file: ProjectFile;
  meta: ProjectMeta;
}

export interface InitPayload {
  app: { name: string; version: string };
  prefs: Preferences;
  project: InitProject;
  projects: ProjectSummary[];
  server: ServerStatus;
  runtime: RuntimeState;
  serverNow: number;
  chat: ChatSnapshot;
  providers: ProviderStatus[];
  notices: string[];
  secretsPersistent: boolean;
}

export type TimerActionName = 'start' | 'pause' | 'reset' | 'toggle';

export interface TwitchAuthPrompt {
  userCode: string;
  verificationUri: string;
  expiresAt: number;
}

export interface YouTubeBroadcast {
  id: string;
  title: string;
  status: string;
  liveChatId: string | null;
  scheduledStart?: string;
}

export interface ProviderSettings {
  twitch: { clientId: string };
  youtube: { clientIdSet: boolean; minPollMs: number };
}

export interface NeonStageApi {
  init(): Promise<InitPayload>;
  updateDraft(doc: ProjectDoc): Promise<{ accepted: boolean }>;
  publish(): Promise<ProjectMeta>;
  setLiveEdit(on: boolean): Promise<ProjectMeta>;
  setProgramScene(sceneId: string): Promise<ProjectMeta>;
  listProjects(): Promise<ProjectSummary[]>;
  openProject(id: string): Promise<InitProject>;
  createProject(name: string, templateId?: string): Promise<InitProject>;
  renameProject(name: string): Promise<ProjectMeta>;
  deleteProject(id: string): Promise<boolean>;
  exportProject(): Promise<{ saved: boolean; fileName?: string; missingAssets?: string[] }>;
  importProject(): Promise<InitProject | null>;
  importAsset(): Promise<AssetRef | null>;
  timerAction(nodeId: string, action: TimerActionName): Promise<void>;
  setGoal(nodeId: string, value: number): Promise<void>;
  sessionAction(action: 'start' | 'stop' | 'reset'): Promise<void>;
  setPort(port: number): Promise<ServerStatus>;
  restartServer(): Promise<ServerStatus>;
  copyText(text: string): Promise<void>;
  openOutputInBrowser(path: string): Promise<void>;
  revealDataFolder(): Promise<void>;
  updatePrefs(patch: Partial<Preferences>): Promise<Preferences>;
  providers: {
    getStatus(): Promise<ProviderStatus[]>;
    getSettings(): Promise<ProviderSettings>;
    twitchConfigure(cfg: { clientId: string }): Promise<ProviderSettings>;
    twitchStartAuth(): Promise<TwitchAuthPrompt>;
    twitchCancelAuth(): Promise<void>;
    twitchSignOut(): Promise<void>;
    youtubeConfigure(cfg: { clientId: string; clientSecret: string; minPollMs?: number }): Promise<ProviderSettings>;
    youtubeStartAuth(): Promise<void>;
    youtubeCancelAuth(): Promise<void>;
    youtubeSignOut(): Promise<void>;
    youtubeListBroadcasts(): Promise<YouTubeBroadcast[]>;
    reconnect(provider: 'twitch' | 'youtube'): Promise<void>;
  };
  on(event: 'server', cb: (s: ServerStatus) => void): () => void;
  on(event: 'runtime', cb: (p: { runtime: RuntimeState; serverNow: number }) => void): () => void;
  on(event: 'chat', cb: (ops: ChatOp[]) => void): () => void;
  on(event: 'providers', cb: (s: ProviderStatus[]) => void): () => void;
  on(event: 'meta', cb: (m: ProjectMeta) => void): () => void;
  on(event: 'notice', cb: (n: { level: 'info' | 'warn' | 'error'; message: string }) => void): () => void;
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string };

export const IPC_CHANNELS = {
  init: 'neonstage:init',
  updateDraft: 'neonstage:update-draft',
  publish: 'neonstage:publish',
  setLiveEdit: 'neonstage:set-live-edit',
  setProgramScene: 'neonstage:set-program-scene',
  listProjects: 'neonstage:list-projects',
  openProject: 'neonstage:open-project',
  createProject: 'neonstage:create-project',
  renameProject: 'neonstage:rename-project',
  deleteProject: 'neonstage:delete-project',
  exportProject: 'neonstage:export-project',
  importProject: 'neonstage:import-project',
  importAsset: 'neonstage:import-asset',
  timerAction: 'neonstage:timer-action',
  setGoal: 'neonstage:set-goal',
  sessionAction: 'neonstage:session-action',
  setPort: 'neonstage:set-port',
  restartServer: 'neonstage:restart-server',
  copyText: 'neonstage:copy-text',
  openOutputInBrowser: 'neonstage:open-output-in-browser',
  revealDataFolder: 'neonstage:reveal-data-folder',
  updatePrefs: 'neonstage:update-prefs',
  providersGetStatus: 'neonstage:providers:get-status',
  providersGetSettings: 'neonstage:providers:get-settings',
  twitchConfigure: 'neonstage:providers:twitch-configure',
  twitchStartAuth: 'neonstage:providers:twitch-start-auth',
  twitchCancelAuth: 'neonstage:providers:twitch-cancel-auth',
  twitchSignOut: 'neonstage:providers:twitch-sign-out',
  youtubeConfigure: 'neonstage:providers:youtube-configure',
  youtubeStartAuth: 'neonstage:providers:youtube-start-auth',
  youtubeCancelAuth: 'neonstage:providers:youtube-cancel-auth',
  youtubeSignOut: 'neonstage:providers:youtube-sign-out',
  youtubeListBroadcasts: 'neonstage:providers:youtube-list-broadcasts',
  reconnect: 'neonstage:providers:reconnect',
} as const;

export const IPC_EVENTS = {
  server: 'neonstage:event:server',
  runtime: 'neonstage:event:runtime',
  chat: 'neonstage:event:chat',
  providers: 'neonstage:event:providers',
  meta: 'neonstage:event:meta',
  notice: 'neonstage:event:notice',
} as const;

export type IpcEventName = keyof typeof IPC_EVENTS;

export const IPC_EVENT_NAMES = Object.keys(IPC_EVENTS) as IpcEventName[];

export const IdSchema = z.string().regex(/^[a-z0-9_-]{1,64}$/i);
export const PortSchema = z.number().int().min(1024).max(65535);
export const TextSchema = z.string().max(4096);
export const NameSchema = z.string().min(1).max(120);
export const TwitchClientIdSchema = z.string().regex(/^[a-z0-9]{10,64}$/i);
export const YouTubeClientIdSchema = z.string().max(200).regex(/\.apps\.googleusercontent\.com$/);
export const ClientSecretSchema = z.string().max(200);
export const MinPollMsSchema = z.number().int().min(2000).max(120000);

export const PreferencesPatchSchema = z.object({
  port: PortSchema.optional(),
  lastProjectId: z.union([IdSchema, z.null()]).optional(),
  editor: z
    .object({
      snap: z.boolean().optional(),
      gridSize: z.number().min(1).max(500).optional(),
      showGrid: z.boolean().optional(),
      showGuides: z.boolean().optional(),
    })
    .optional(),
});

export const NoArgs = z.tuple([]);
export const UpdateDraftArgs = z.tuple([z.unknown()]);
export const BoolArgs = z.tuple([z.boolean()]);
export const IdArgs = z.tuple([IdSchema]);
export const CreateProjectArgs = z.tuple([NameSchema, IdSchema.optional()]);
export const RenameProjectArgs = z.tuple([NameSchema]);
export const TimerActionArgs = z.tuple([IdSchema, z.enum(['start', 'pause', 'reset', 'toggle'])]);
export const SetGoalArgs = z.tuple([IdSchema, z.number().finite()]);
export const SessionActionArgs = z.tuple([z.enum(['start', 'stop', 'reset'])]);
export const PortArgs = z.tuple([PortSchema]);
export const CopyTextArgs = z.tuple([TextSchema]);
export const OpenOutputArgs = z.tuple([z.string().max(2048)]);
export const UpdatePrefsArgs = z.tuple([PreferencesPatchSchema]);
export const TwitchConfigureArgs = z.tuple([z.object({ clientId: TwitchClientIdSchema })]);
export const YouTubeConfigureArgs = z.tuple([
  z.object({
    clientId: YouTubeClientIdSchema,
    clientSecret: ClientSecretSchema,
    minPollMs: MinPollMsSchema.optional(),
  }),
]);
export const ReconnectArgs = z.tuple([z.enum(['twitch', 'youtube'])]);
