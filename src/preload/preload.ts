import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  IPC_CHANNELS,
  IPC_EVENTS,
  IPC_EVENT_NAMES,
  type IpcEventName,
  type IpcResult,
  type NeonStageApi,
} from '../shared/ipc';

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, ...args)) as IpcResult<T> | undefined;
  if (!result || typeof result !== 'object' || typeof result.ok !== 'boolean') {
    throw new Error('NeonStage did not respond correctly.');
  }
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

function on(event: IpcEventName, cb: (payload: unknown) => void): () => void {
  if (!IPC_EVENT_NAMES.includes(event)) throw new Error('Unknown NeonStage event.');
  const channel = IPC_EVENTS[event];
  const listener = (_event: IpcRendererEvent, payload: unknown): void => {
    cb(payload);
  };
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const api: NeonStageApi = {
  init: () => invoke(IPC_CHANNELS.init),
  updateDraft: (doc) => invoke(IPC_CHANNELS.updateDraft, doc),
  publish: () => invoke(IPC_CHANNELS.publish),
  setLiveEdit: (on) => invoke(IPC_CHANNELS.setLiveEdit, on),
  setProgramScene: (sceneId) => invoke(IPC_CHANNELS.setProgramScene, sceneId),
  listProjects: () => invoke(IPC_CHANNELS.listProjects),
  openProject: (id) => invoke(IPC_CHANNELS.openProject, id),
  createProject: (name, templateId) => invoke(IPC_CHANNELS.createProject, name, templateId),
  renameProject: (name) => invoke(IPC_CHANNELS.renameProject, name),
  deleteProject: (id) => invoke(IPC_CHANNELS.deleteProject, id),
  exportProject: () => invoke(IPC_CHANNELS.exportProject),
  importProject: () => invoke(IPC_CHANNELS.importProject),
  importAsset: () => invoke(IPC_CHANNELS.importAsset),
  timerAction: (nodeId, action) => invoke(IPC_CHANNELS.timerAction, nodeId, action),
  setGoal: (nodeId, value) => invoke(IPC_CHANNELS.setGoal, nodeId, value),
  sessionAction: (action) => invoke(IPC_CHANNELS.sessionAction, action),
  setPort: (port) => invoke(IPC_CHANNELS.setPort, port),
  restartServer: () => invoke(IPC_CHANNELS.restartServer),
  copyText: (text) => invoke(IPC_CHANNELS.copyText, text),
  openOutputInBrowser: (path) => invoke(IPC_CHANNELS.openOutputInBrowser, path),
  revealDataFolder: () => invoke(IPC_CHANNELS.revealDataFolder),
  updatePrefs: (patch) => invoke(IPC_CHANNELS.updatePrefs, patch),
  providers: {
    getStatus: () => invoke(IPC_CHANNELS.providersGetStatus),
    getSettings: () => invoke(IPC_CHANNELS.providersGetSettings),
    twitchConfigure: (cfg) => invoke(IPC_CHANNELS.twitchConfigure, cfg),
    twitchStartAuth: () => invoke(IPC_CHANNELS.twitchStartAuth),
    twitchCancelAuth: () => invoke(IPC_CHANNELS.twitchCancelAuth),
    twitchSignOut: () => invoke(IPC_CHANNELS.twitchSignOut),
    youtubeConfigure: (cfg) => invoke(IPC_CHANNELS.youtubeConfigure, cfg),
    youtubeStartAuth: () => invoke(IPC_CHANNELS.youtubeStartAuth),
    youtubeCancelAuth: () => invoke(IPC_CHANNELS.youtubeCancelAuth),
    youtubeSignOut: () => invoke(IPC_CHANNELS.youtubeSignOut),
    youtubeListBroadcasts: () => invoke(IPC_CHANNELS.youtubeListBroadcasts),
    reconnect: (provider) => invoke(IPC_CHANNELS.reconnect, provider),
  },
  on: on as NeonStageApi['on'],
};

contextBridge.exposeInMainWorld('neonstage', api);
