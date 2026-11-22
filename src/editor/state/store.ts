import { useCallback, useRef, useSyncExternalStore } from 'react';
import type { ProviderStatus } from '../../shared/chat';
import type { Preferences, ProjectMeta, ProjectSummary, ServerStatus } from '../../shared/ipc';
import { createEmptyProject, type ProjectDoc, type Scene } from '../../shared/model';

export interface Notice {
  id: number;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface Viewport {
  w: number;
  h: number;
}

export type SettingsSection = 'connections' | 'outputs' | 'general';

export interface HistoryDepth {
  past: number;
  future: number;
}

export interface EditorState {
  ready: boolean;
  app: { name: string; version: string };
  doc: ProjectDoc;
  meta: ProjectMeta;
  projects: ProjectSummary[];
  prefs: Preferences;
  server: ServerStatus;
  providers: ProviderStatus[];
  activeSceneId: string;
  selection: string[];
  enteredGroupId: string | null;
  zoom: number;
  pan: { x: number; y: number };
  viewport: Viewport;
  outputPreview: boolean;
  settingsOpen: boolean;
  settingsSection: SettingsSection;
  focusProvider: 'twitch' | 'youtube' | null;
  controlsOpen: boolean;
  historyDepth: HistoryDepth;
  secretsPersistent: boolean;
  notices: Notice[];
}

const bootDoc = createEmptyProject('NeonStage');

const SETTINGS_SECTIONS: SettingsSection[] = ['connections', 'outputs', 'general'];

interface InitialView {
  settingsOpen: boolean;
  settingsSection: SettingsSection;
  controlsOpen: boolean;
}

function initialView(): InitialView {
  const view: InitialView = {
    settingsOpen: false,
    settingsSection: 'connections',
    controlsOpen: false,
  };
  if (typeof window === 'undefined') return view;
  const hash = window.location.hash;
  if (/(?:^#|&)controls(?:&|$)/.test(hash)) view.controlsOpen = true;
  const match = /(?:^#|&)settings=([a-z]+)/.exec(hash);
  const section = match?.[1] as SettingsSection | undefined;
  if (section && SETTINGS_SECTIONS.includes(section)) {
    view.settingsOpen = true;
    view.settingsSection = section;
  }
  return view;
}

const bootView = initialView();

export const initialState: EditorState = {
  ready: false,
  app: { name: 'NeonStage', version: '' },
  doc: bootDoc,
  meta: {
    projectId: bootDoc.id,
    name: bootDoc.name,
    saveState: 'saved',
    lastSavedAt: null,
    liveDiffers: false,
    liveEdit: false,
    programSceneId: bootDoc.scenes[0]!.id,
    liveRev: 0,
  },
  projects: [],
  prefs: {
    port: 8790,
    lastProjectId: null,
    editor: { snap: true, gridSize: 40, showGrid: false, showGuides: true },
  },
  server: { state: 'starting', port: 8790, baseUrl: null },
  providers: [],
  activeSceneId: bootDoc.scenes[0]!.id,
  selection: [],
  enteredGroupId: null,
  zoom: 0.5,
  pan: { x: 0, y: 0 },
  viewport: { w: 0, h: 0 },
  outputPreview: false,
  settingsOpen: bootView.settingsOpen,
  settingsSection: bootView.settingsSection,
  focusProvider: null,
  controlsOpen: bootView.controlsOpen,
  historyDepth: { past: 0, future: 0 },
  secretsPersistent: true,
  notices: [],
};

type Listener = () => void;

class EditorStore {
  private state: EditorState = initialState;
  private readonly listeners = new Set<Listener>();

  getState = (): EditorState => this.state;

  set = (patch: Partial<EditorState> | ((state: EditorState) => Partial<EditorState>)): void => {
    const next = typeof patch === 'function' ? patch(this.state) : patch;
    this.state = { ...this.state, ...next };
    for (const listener of [...this.listeners]) listener();
  };

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
}

export const store = new EditorStore();

export function selectScene(state: EditorState): Scene {
  return state.doc.scenes.find((scene) => scene.id === state.activeSceneId) ?? state.doc.scenes[0]!;
}

export function useEditor<T>(selector: (state: EditorState) => T): T {
  const cache = useRef<{ selector: (state: EditorState) => T; state: EditorState; value: T } | null>(
    null,
  );
  const getSnapshot = useCallback((): T => {
    const state = store.getState();
    const current = cache.current;
    if (current && current.selector === selector && current.state === state) return current.value;
    const value = selector(state);
    cache.current = { selector, state, value };
    return value;
  }, [selector]);
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}
