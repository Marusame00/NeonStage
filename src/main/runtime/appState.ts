import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { applyChatOps, type ChatOp, type ChatSnapshot } from '../../shared/chat';
import type { ProjectMeta } from '../../shared/ipc';
import type { ProjectDoc, ProjectFile } from '../../shared/model';
import {
  emptyRuntime,
  pruneRuntime,
  sessionAction,
  setGoal,
  timerAction,
  type RuntimeState,
  type SessionAction,
  type TimerAction,
} from '../../shared/runtime';
import { parseProjectDoc } from '../../shared/schema';
import type { ProjectStore, SaveState } from '../store/projectStore';
import { writeFileAtomic } from '../store/atomic';

export interface AppStateOptions {
  store: ProjectStore;
  runtimeFile: string;
  now?: () => number;
}

function isRuntimeState(value: unknown): value is RuntimeState {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<RuntimeState>;
  return (
    typeof candidate.timers === 'object' &&
    candidate.timers !== null &&
    typeof candidate.goals === 'object' &&
    candidate.goals !== null &&
    typeof candidate.session === 'object' &&
    candidate.session !== null
  );
}

function readRuntimeFile(file: string): Record<string, RuntimeState> {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof raw !== 'object' || raw === null) return {};
    const out: Record<string, RuntimeState> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (isRuntimeState(value)) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function collectNodeIds(doc: ProjectDoc): Set<string> {
  const ids = new Set<string>();
  for (const scene of doc.scenes) {
    for (const id of Object.keys(scene.nodes)) ids.add(id);
  }
  return ids;
}

export class AppState extends EventEmitter {
  private projectFile: ProjectFile;
  private runtimeState: RuntimeState;
  private chatState: ChatSnapshot = {};
  private rev = 0;
  private saveState: SaveState = 'saved';
  private lastSavedAt: number | null = null;
  private saveError: string | undefined;
  private runtimeByProject: Record<string, RuntimeState>;
  private runtimeTimer: NodeJS.Timeout | null = null;
  private diffCache: { draft: ProjectDoc; live: ProjectDoc; value: boolean } | null = null;
  private readonly now: () => number;

  constructor(file: ProjectFile, private readonly options: AppStateOptions) {
    super();
    this.projectFile = file;
    this.now = options.now ?? Date.now;
    this.runtimeByProject = readRuntimeFile(options.runtimeFile);
    this.runtimeState = this.runtimeByProject[file.draft.id] ?? emptyRuntime();
    options.store.onSaveState = (id, state, error) => {
      if (id !== this.projectFile.draft.id) return;
      this.saveState = state;
      if (state === 'saved') {
        this.lastSavedAt = this.now();
        this.saveError = undefined;
      } else if (state === 'error') {
        this.saveError = error ?? 'Could not save the project.';
      }
      this.emit('meta', this.meta());
    };
  }

  get projectId(): string {
    return this.projectFile.draft.id;
  }

  get file(): ProjectFile {
    return this.projectFile;
  }

  get draft(): ProjectDoc {
    return this.projectFile.draft;
  }

  get live(): ProjectDoc {
    return this.projectFile.live;
  }

  get programSceneId(): string {
    return this.projectFile.programSceneId;
  }

  get liveEdit(): boolean {
    return this.projectFile.liveEdit;
  }

  get runtime(): RuntimeState {
    return this.runtimeState;
  }

  get chat(): ChatSnapshot {
    return this.chatState;
  }

  get liveRev(): number {
    return this.rev;
  }

  meta(): ProjectMeta {
    return {
      projectId: this.projectFile.draft.id,
      name: this.projectFile.draft.name,
      saveState: this.saveState,
      lastSavedAt: this.lastSavedAt,
      ...(this.saveError ? { error: this.saveError } : {}),
      liveDiffers: this.liveDiffers(),
      liveEdit: this.projectFile.liveEdit,
      programSceneId: this.projectFile.programSceneId,
      liveRev: this.rev,
    };
  }

  load(file: ProjectFile): void {
    const sameProject = file.draft.id === this.projectFile.draft.id;
    this.projectFile = file;
    this.diffCache = null;
    if (!sameProject) {
      this.runtimeState = this.runtimeByProject[file.draft.id] ?? emptyRuntime();
      this.chatState = {};
      this.rev = 0;
      this.saveState = 'saved';
      this.lastSavedAt = null;
      this.saveError = undefined;
    }
    this.emit('draft', this.projectFile.draft);
    this.emit('live', this.projectFile.live);
    this.emit('runtime', this.runtimeState);
    this.emit('chat', this.chatState);
    this.emit('meta', this.meta());
  }

  updateDraft(rawDoc: unknown): boolean {
    let doc: ProjectDoc;
    try {
      doc = parseProjectDoc(rawDoc);
    } catch {
      return false;
    }
    doc = { ...doc, id: this.projectFile.draft.id };
    this.projectFile = { ...this.projectFile, draft: doc };
    this.diffCache = null;
    this.emit('draft', doc);
    if (this.projectFile.liveEdit) {
      this.publish();
    } else {
      this.persist();
      this.emit('meta', this.meta());
    }
    return true;
  }

  publish(): ProjectMeta {
    const live = structuredClone(this.projectFile.draft);
    this.projectFile = { ...this.projectFile, live };
    this.rev += 1;
    this.diffCache = null;

    const pruned = pruneRuntime(this.runtimeState, collectNodeIds(live));
    const runtimeChanged = JSON.stringify(pruned) !== JSON.stringify(this.runtimeState);
    if (runtimeChanged) {
      this.runtimeState = pruned;
      this.persistRuntime();
    }

    this.persist();
    this.emit('live', live);
    if (runtimeChanged) this.emit('runtime', this.runtimeState);
    const meta = this.meta();
    this.emit('meta', meta);
    return meta;
  }

  setLiveEdit(on: boolean): ProjectMeta {
    this.projectFile = { ...this.projectFile, liveEdit: on };
    if (on) return this.publish();
    this.persist();
    const meta = this.meta();
    this.emit('meta', meta);
    return meta;
  }

  setProgramScene(sceneId: string): ProjectMeta {
    if (!this.projectFile.draft.scenes.some((scene) => scene.id === sceneId)) {
      throw new Error('That scene no longer exists.');
    }
    this.projectFile = { ...this.projectFile, programSceneId: sceneId };
    this.persist();
    const meta = this.meta();
    this.emit('meta', meta);
    return meta;
  }

  timerAction(nodeId: string, action: TimerAction): void {
    this.runtimeState = timerAction(this.runtimeState, nodeId, action, this.now());
    this.persistRuntime();
    this.emit('runtime', this.runtimeState);
  }

  setGoal(nodeId: string, value: number): void {
    this.runtimeState = setGoal(this.runtimeState, nodeId, value);
    this.persistRuntime();
    this.emit('runtime', this.runtimeState);
  }

  sessionAction(action: SessionAction): void {
    this.runtimeState = sessionAction(this.runtimeState, action, this.now());
    this.persistRuntime();
    this.emit('runtime', this.runtimeState);
  }

  applyChat(ops: ChatOp[]): void {
    if (ops.length === 0) return;
    this.chatState = applyChatOps(this.chatState, ops);
    this.emit('chat', this.chatState);
  }

  flush(): void {
    this.options.store.flush();
    if (this.runtimeTimer) {
      clearTimeout(this.runtimeTimer);
      this.runtimeTimer = null;
    }
    this.writeRuntime();
  }

  dispose(): void {
    this.flush();
    this.removeAllListeners();
  }

  private persist(): void {
    this.options.store.scheduleSave(this.projectFile.draft.id, this.projectFile);
  }

  private persistRuntime(): void {
    if (this.runtimeTimer) clearTimeout(this.runtimeTimer);
    this.runtimeTimer = setTimeout(() => {
      this.runtimeTimer = null;
      this.writeRuntime();
    }, 500);
    this.runtimeTimer.unref();
  }

  private writeRuntime(): void {
    this.runtimeByProject[this.projectFile.draft.id] = this.runtimeState;
    try {
      writeFileAtomic(this.options.runtimeFile, JSON.stringify(this.runtimeByProject, null, 2));
    } catch {
      this.emit('meta', this.meta());
    }
  }

  private liveDiffers(): boolean {
    const cached = this.diffCache;
    if (
      cached &&
      cached.draft === this.projectFile.draft &&
      cached.live === this.projectFile.live
    ) {
      return cached.value;
    }
    const value =
      JSON.stringify(this.projectFile.draft) !== JSON.stringify(this.projectFile.live);
    this.diffCache = { draft: this.projectFile.draft, live: this.projectFile.live, value };
    return value;
  }
}
