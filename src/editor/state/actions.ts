import { toBroadcastSafe, type ProviderStatus } from '../../shared/chat';
import type { InitProject, Preferences, ProjectMeta, ProjectSummary, ServerStatus } from '../../shared/ipc';
import {
  CANVAS_PRESETS,
  createScene,
  type ProjectDoc,
  type Scene,
  type SceneNode,
} from '../../shared/model';
import {
  addNode,
  addScene,
  alignNodes,
  createWidgetNode,
  distributeNodes,
  duplicateNodes,
  duplicateScene,
  groupNodes,
  moveNodes,
  removeNodes,
  removeScene,
  renameScene,
  reorder,
  setNodeRect,
  setSceneSize,
  ungroup,
  updateNode,
  updateNodeStyle,
  updateWidgetProps,
  type AlignMode,
  type ReorderDirection,
  type SceneSizeMode,
} from '../../shared/ops';
import type { NodeStyle } from '../../shared/model';
import type { Rect } from '../../shared/geometry';
import { createRenderStores } from '../../render';
import {
  beginTransient,
  commit,
  createHistory,
  endTransient,
  redo as redoHistory,
  transient,
  undo as undoHistory,
  type HistoryState,
  type TransientState,
} from './history';
import { selectScene, store, type HistoryDepth, type Notice, type SettingsSection } from './store';

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 8;

export type PrefsPatch = {
  port?: number;
  lastProjectId?: string | null;
  editor?: Partial<Preferences['editor']>;
};

export const renderStores = createRenderStores();

let history: HistoryState = createHistory();
let drag: TransientState | null = null;
let noticeSeq = 0;
let booted = false;
let syncTimer: ReturnType<typeof setTimeout> | null = null;
let pendingDoc: ProjectDoc | null = null;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function historyDepth(): HistoryDepth {
  return { past: history.past.length, future: history.future.length };
}

export function toast(level: Notice['level'], message: string): void {
  noticeSeq += 1;
  const notice: Notice = { id: noticeSeq, level, message };
  store.set((state) => ({ notices: [...state.notices, notice].slice(-4) }));
  setTimeout(() => dismissNotice(notice.id), level === 'error' ? 7000 : 4500);
}

export function dismissNotice(id: number): void {
  store.set((state) => ({ notices: state.notices.filter((notice) => notice.id !== id) }));
}

function scheduleSync(doc: ProjectDoc): void {
  pendingDoc = doc;
  if (syncTimer !== null) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    const next = pendingDoc;
    pendingDoc = null;
    if (next) void flushDraft(next);
  }, 150);
}

async function flushDraft(doc: ProjectDoc): Promise<void> {
  try {
    const result = await window.neonstage.updateDraft(doc);
    if (!result.accepted) toast('error', 'The change was rejected by the output server.');
  } catch (error) {
    toast('error', error instanceof Error ? error.message : 'Could not save the change.');
  }
}

export function applyDoc(next: ProjectDoc, coalesceKey: string | null = null): void {
  const current = store.getState().doc;
  if (next === current) return;
  history = commit(history, current, next, coalesceKey, Date.now());
  store.set({ doc: next, historyDepth: historyDepth() });
  scheduleSync(next);
}

export function beginDrag(): void {
  drag = beginTransient(store.getState().doc);
}

export function dragDoc(next: ProjectDoc): void {
  if (!drag) return;
  drag = transient(drag, next);
  store.set({ doc: next });
}

export function endDrag(): void {
  if (!drag) return;
  const result = endTransient(drag, history, Date.now());
  drag = null;
  history = result.history;
  if (result.changed) {
    store.set({ historyDepth: historyDepth() });
    scheduleSync(store.getState().doc);
  }
}

function filterSelection(doc: ProjectDoc): void {
  const state = store.getState();
  const scene = doc.scenes.find((entry) => entry.id === state.activeSceneId) ?? doc.scenes[0];
  if (!scene) return;
  const selection = state.selection.filter((id) => scene.nodes[id] !== undefined);
  const enteredGroupId =
    state.enteredGroupId && scene.nodes[state.enteredGroupId] ? state.enteredGroupId : null;
  if (selection.length !== state.selection.length || enteredGroupId !== state.enteredGroupId) {
    store.set({ selection, enteredGroupId });
  }
}

export function undo(): void {
  const result = undoHistory(history, store.getState().doc);
  if (!result) return;
  history = result.history;
  store.set({ doc: result.doc, historyDepth: historyDepth() });
  filterSelection(result.doc);
  scheduleSync(result.doc);
}

export function redo(): void {
  const result = redoHistory(history, store.getState().doc, Date.now());
  if (!result) return;
  history = result.history;
  store.set({ doc: result.doc, historyDepth: historyDepth() });
  filterSelection(result.doc);
  scheduleSync(result.doc);
}

export function updateSceneDoc(
  update: (scene: Scene) => Scene,
  coalesceKey: string | null = null,
): void {
  const state = store.getState();
  const scene = selectScene(state);
  const nextScene = update(scene);
  if (nextScene === scene) return;
  applyDoc(
    {
      ...state.doc,
      scenes: state.doc.scenes.map((entry) => (entry.id === scene.id ? nextScene : entry)),
      updatedAt: new Date().toISOString(),
    },
    coalesceKey,
  );
}

export function updateDoc(update: (doc: ProjectDoc) => ProjectDoc, coalesceKey: string | null = null): void {
  applyDoc(update(store.getState().doc), coalesceKey);
}

export function setSelection(ids: string[]): void {
  store.set({ selection: ids });
}

export function selectNodeInScene(sceneId: string, nodeId: string): void {
  if (store.getState().activeSceneId === sceneId) {
    store.set({ selection: [nodeId] });
    return;
  }
  store.set({ activeSceneId: sceneId, selection: [nodeId], enteredGroupId: null });
  fitView();
}

export function openSettings(section: SettingsSection, provider: 'twitch' | 'youtube' | null = null): void {
  store.set({ settingsOpen: true, settingsSection: section, focusProvider: provider });
}

export function closeSettings(): void {
  store.set({ settingsOpen: false, focusProvider: null });
}

export function toggleControls(on?: boolean): void {
  store.set((state) => ({ controlsOpen: on ?? !state.controlsOpen }));
}

export function setServerStatus(status: ServerStatus): void {
  store.set({ server: status });
}

export function setProviders(statuses: ProviderStatus[]): void {
  store.set({ providers: statuses });
}

export function toggleSelected(id: string): void {
  store.set((state) => ({
    selection: state.selection.includes(id)
      ? state.selection.filter((entry) => entry !== id)
      : [...state.selection, id],
  }));
}

export function clearSelection(): void {
  store.set({ selection: [] });
}

export function enterGroup(id: string): void {
  store.set({ enteredGroupId: id, selection: [] });
}

export function exitGroup(): void {
  const state = store.getState();
  const scene = selectScene(state);
  const group = state.enteredGroupId ? scene.nodes[state.enteredGroupId] : null;
  store.set({
    enteredGroupId: group?.parentId ?? null,
    selection: group ? [group.id] : [],
  });
}

export function deleteSelection(): void {
  const state = store.getState();
  if (state.selection.length === 0) return;
  updateSceneDoc((scene) => removeNodes(scene, state.selection));
  store.set({ selection: [] });
}

export function deleteNodes(ids: string[]): void {
  if (ids.length === 0) return;
  updateSceneDoc((scene) => removeNodes(scene, ids));
  store.set((state) => ({ selection: state.selection.filter((id) => !ids.includes(id)) }));
}

export function duplicateSelection(): void {
  const state = store.getState();
  if (state.selection.length === 0) return;
  let created: string[] = [];
  updateSceneDoc((scene) => {
    const result = duplicateNodes(scene, state.selection);
    created = result.newIds;
    return result.scene;
  });
  if (created.length > 0) store.set({ selection: created });
}

export function groupSelection(): void {
  const state = store.getState();
  if (state.selection.length < 2) return;
  let groupId: string | null = null;
  try {
    updateSceneDoc((scene) => {
      const result = groupNodes(scene, state.selection, 'Group');
      groupId = result.groupId;
      return result.scene;
    });
  } catch (error) {
    toast('warn', error instanceof Error ? error.message : 'Those objects cannot be grouped.');
    return;
  }
  if (groupId) store.set({ selection: [groupId] });
}

export function ungroupSelection(): void {
  const state = store.getState();
  const scene = selectScene(state);
  const groups = state.selection.filter((id) => scene.nodes[id]?.type === 'group');
  if (groups.length === 0) return;
  let children: string[] = [];
  updateSceneDoc((current) => {
    let next = current;
    const collected: string[] = [];
    for (const id of groups) {
      const result = ungroup(next, id);
      next = result.scene;
      collected.push(...result.childIds);
    }
    children = collected;
    return next;
  });
  store.set({ selection: children });
}

export function nudgeSelection(dx: number, dy: number): void {
  const state = store.getState();
  if (state.selection.length === 0) return;
  updateSceneDoc((scene) => moveNodes(scene, state.selection, dx, dy), 'nudge');
}

export function alignSelection(mode: AlignMode): void {
  const state = store.getState();
  if (state.selection.length === 0) return;
  const reference = state.selection.length > 1 ? 'selection' : 'canvas';
  updateSceneDoc((scene) => alignNodes(scene, state.selection, mode, reference));
}

export function distributeSelection(axis: 'h' | 'v'): void {
  const state = store.getState();
  if (state.selection.length < 3) return;
  updateSceneDoc((scene) => distributeNodes(scene, state.selection, axis));
}

export function reorderSelection(direction: ReorderDirection): void {
  const state = store.getState();
  if (state.selection.length === 0) return;
  updateSceneDoc((scene) => reorder(scene, state.selection, direction));
}

export function setNodeRectAction(id: string, rect: Rect, coalesceKey: string | null = null): void {
  updateSceneDoc((scene) => setNodeRect(scene, id, rect), coalesceKey);
}

export function patchNode(id: string, patch: Partial<SceneNode>, coalesceKey: string | null = null): void {
  updateSceneDoc((scene) => updateNode(scene, id, patch), coalesceKey);
}

export function patchStyle(ids: string[], patch: Partial<NodeStyle>, coalesceKey: string | null = null): void {
  updateSceneDoc((scene) => updateNodeStyle(scene, ids, patch), coalesceKey);
}

export function patchProps(id: string, patch: Record<string, unknown>, coalesceKey: string | null = null): void {
  updateSceneDoc((scene) => updateWidgetProps(scene, id, patch), coalesceKey);
}

export function addWidget(kind: string, centerX: number, centerY: number): void {
  const state = store.getState();
  const node = createWidgetNode(kind, 0, 0);
  const placed: SceneNode = {
    ...node,
    x: Math.round(centerX - node.w / 2),
    y: Math.round(centerY - node.h / 2),
  };
  updateSceneDoc((scene) => addNode(scene, placed, state.enteredGroupId));
  store.set({ selection: [placed.id] });
}

export function addTemplateScene(build: (w: number, h: number) => Scene): void {
  const state = store.getState();
  const scene = selectScene(state);
  const built = build(scene.width, scene.height);
  updateDoc((doc) => addScene(doc, built));
  store.set({ activeSceneId: built.id, selection: [], enteredGroupId: null });
  fitView();
}

export function createNewScene(name: string, presetId: string): void {
  const preset = CANVAS_PRESETS.find((entry) => entry.id === presetId) ?? CANVAS_PRESETS[0]!;
  const scene = createScene(name.trim() || 'Scene', preset.width, preset.height);
  updateDoc((doc) => addScene(doc, scene));
  store.set({ activeSceneId: scene.id, selection: [], enteredGroupId: null });
  fitView();
}

export function duplicateActiveScene(): void {
  const state = store.getState();
  const scene = selectScene(state);
  updateDoc((doc) => duplicateScene(doc, scene.id));
  const next = store.getState().doc.scenes;
  const copy = next[next.findIndex((entry) => entry.id === scene.id) + 1];
  if (copy) store.set({ activeSceneId: copy.id, selection: [], enteredGroupId: null });
}

export function deleteScene(id: string): void {
  const state = store.getState();
  if (state.doc.scenes.length <= 1) {
    toast('warn', 'A project needs at least one scene.');
    return;
  }
  updateDoc((doc) => removeScene(doc, id));
  const doc = store.getState().doc;
  if (store.getState().activeSceneId === id) {
    store.set({ activeSceneId: doc.scenes[0]!.id, selection: [], enteredGroupId: null });
    fitView();
  }
}

export function renameSceneAction(id: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  updateDoc((doc) => renameScene(doc, id, trimmed));
}

export function selectSceneAction(id: string): void {
  store.set({ activeSceneId: id, selection: [], enteredGroupId: null });
  fitView();
}

export function setSceneSizeAction(width: number, height: number, mode: SceneSizeMode): void {
  const state = store.getState();
  const scene = selectScene(state);
  updateDoc((doc) => setSceneSize(doc, scene.id, Math.max(16, width), Math.max(16, height), mode));
  fitView();
}

export function setReduceMotion(on: boolean): void {
  updateDoc((doc) => ({ ...doc, settings: { ...doc.settings, reduceMotion: on } }));
}

export function setZoom(zoom: number): void {
  store.set({ zoom: clamp(zoom, MIN_ZOOM, MAX_ZOOM) });
}

export function zoomAt(zoom: number, cx: number, cy: number): void {
  const state = store.getState();
  const next = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
  const factor = next / state.zoom;
  store.set({
    zoom: next,
    pan: {
      x: cx - (cx - state.pan.x) * factor,
      y: cy - (cy - state.pan.y) * factor,
    },
  });
}

export function panBy(dx: number, dy: number): void {
  store.set((state) => ({ pan: { x: state.pan.x + dx, y: state.pan.y + dy } }));
}

export function setPan(x: number, y: number): void {
  store.set({ pan: { x, y } });
}

export function fitView(): void {
  const state = store.getState();
  const scene = selectScene(state);
  const { w, h } = state.viewport;
  if (w <= 0 || h <= 0) return;
  const zoom = clamp(
    Math.min((w - 72) / scene.width, (h - 72) / scene.height),
    MIN_ZOOM,
    MAX_ZOOM,
  );
  store.set({
    zoom,
    pan: { x: (w - scene.width * zoom) / 2, y: (h - scene.height * zoom) / 2 },
  });
}

export function setOutputPreview(on: boolean): void {
  store.set({ outputPreview: on });
}

export async function patchPrefs(patch: PrefsPatch): Promise<void> {
  try {
    const prefs = await window.neonstage.updatePrefs(patch as Partial<Preferences>);
    store.set({ prefs });
  } catch (error) {
    toast('error', error instanceof Error ? error.message : 'Could not save preferences.');
  }
}

export async function publish(): Promise<void> {
  try {
    const meta = await window.neonstage.publish();
    store.set({ meta });
    toast('info', 'Published to OBS.');
  } catch (error) {
    toast('error', error instanceof Error ? error.message : 'Publishing failed.');
  }
}

export async function setLiveEdit(on: boolean): Promise<void> {
  try {
    const meta = await window.neonstage.setLiveEdit(on);
    store.set({ meta });
  } catch (error) {
    toast('error', error instanceof Error ? error.message : 'Could not change live edit.');
  }
}

export async function setProgramScene(sceneId: string): Promise<void> {
  try {
    const meta: ProjectMeta = await window.neonstage.setProgramScene(sceneId);
    store.set({ meta });
    toast('info', 'Program scene changed. /output/live follows it now.');
  } catch (error) {
    toast('error', error instanceof Error ? error.message : 'Could not set the program scene.');
  }
}

export async function refreshProjects(): Promise<ProjectSummary[]> {
  try {
    const projects = await window.neonstage.listProjects();
    store.set({ projects });
    return projects;
  } catch {
    return store.getState().projects;
  }
}

export function adoptProject(project: InitProject): void {
  history = createHistory();
  drag = null;
  const programScene = project.file.draft.scenes.find(
    (scene) => scene.id === project.meta.programSceneId,
  );
  store.set({
    doc: project.file.draft,
    meta: project.meta,
    activeSceneId: (programScene ?? project.file.draft.scenes[0]!).id,
    selection: [],
    enteredGroupId: null,
    historyDepth: historyDepth(),
  });
  fitView();
}

export async function bootstrap(): Promise<void> {
  if (booted) return;
  booted = true;
  try {
    const payload = await window.neonstage.init();
    renderStores.runtime.set(payload.runtime, payload.serverNow);
    renderStores.chat.reset(payload.chat);
    renderStores.status.set(toBroadcastSafe(payload.providers));
    const draft = payload.project.file.draft;
    const programScene = draft.scenes.find((scene) => scene.id === payload.project.meta.programSceneId);
    store.set({
      ready: true,
      app: payload.app,
      doc: draft,
      meta: payload.project.meta,
      projects: payload.projects,
      prefs: payload.prefs,
      server: payload.server,
      providers: payload.providers,
      secretsPersistent: payload.secretsPersistent,
      activeSceneId: (programScene ?? draft.scenes[0]!).id,
      selection: [],
      enteredGroupId: null,
    });
    for (const notice of payload.notices) toast('warn', notice);
    window.neonstage.on('runtime', (value) => renderStores.runtime.set(value.runtime, value.serverNow));
    window.neonstage.on('chat', (ops) => renderStores.chat.apply(ops));
    window.neonstage.on('providers', (statuses) => {
      renderStores.status.set(toBroadcastSafe(statuses));
      store.set({ providers: statuses });
    });
    window.neonstage.on('meta', (meta) => store.set({ meta }));
    window.neonstage.on('server', (server) => store.set({ server }));
    window.neonstage.on('notice', (notice) => toast(notice.level, notice.message));
  } catch (error) {
    toast('error', error instanceof Error ? error.message : 'NeonStage could not start.');
  }
}
