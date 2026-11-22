import {
  applyChatOps,
  type BroadcastSafeStatus,
  type ChatMessage,
  type ChatOp,
  type ChatSnapshot,
} from '../shared/chat';
import { emptyRuntime, type RuntimeState } from '../shared/runtime';

type Listener = () => void;

const EMPTY_MESSAGES: ChatMessage[] = [];

export class RuntimeStore {
  private runtime: RuntimeState = emptyRuntime();
  private offset = 0;
  private readonly listeners = new Set<Listener>();

  set(runtime: RuntimeState, serverNow: number): void {
    this.offset = serverNow - Date.now();
    this.runtime = runtime;
    this.emit();
  }

  setServerNow(serverNow: number): void {
    this.offset = serverNow - Date.now();
  }

  getRuntime = (): RuntimeState => this.runtime;

  serverNow = (): number => Date.now() + this.offset;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

export class ChatStore {
  private snapshot: ChatSnapshot = {};
  private readonly listeners = new Map<string, Set<Listener>>();

  reset(snapshot: ChatSnapshot): void {
    this.snapshot = { ...snapshot };
    const keys = new Set([...Object.keys(snapshot), ...this.listeners.keys()]);
    for (const key of keys) this.notify(key);
  }

  apply(ops: ChatOp[]): void {
    if (ops.length === 0) return;
    this.snapshot = applyChatOps(this.snapshot, ops);
    for (const key of new Set(ops.map((op) => op.sourceKey))) this.notify(key);
  }

  getSource = (key: string): ChatMessage[] => this.snapshot[key] ?? EMPTY_MESSAGES;

  subscribe = (key: string, listener: Listener): (() => void) => {
    let set = this.listeners.get(key);
    if (!set) {
      set = new Set();
      this.listeners.set(key, set);
    }
    set.add(listener);
    return () => {
      const current = this.listeners.get(key);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) this.listeners.delete(key);
    };
  };

  private notify(key: string): void {
    const set = this.listeners.get(key);
    if (!set) return;
    for (const listener of [...set]) listener();
  }
}

export class StatusStore {
  private status: BroadcastSafeStatus = {};
  private readonly listeners = new Map<string, Set<Listener>>();

  set(status: BroadcastSafeStatus): void {
    this.status = { ...status };
    const keys = new Set([...Object.keys(status), ...this.listeners.keys()]);
    for (const key of keys) this.notify(key);
  }

  get = (key: string): BroadcastSafeStatus[string] | undefined => this.status[key];

  subscribe = (key: string, listener: Listener): (() => void) => {
    let set = this.listeners.get(key);
    if (!set) {
      set = new Set();
      this.listeners.set(key, set);
    }
    set.add(listener);
    return () => {
      const current = this.listeners.get(key);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) this.listeners.delete(key);
    };
  };

  private notify(key: string): void {
    const set = this.listeners.get(key);
    if (!set) return;
    for (const listener of [...set]) listener();
  }
}

export interface RenderStores {
  runtime: RuntimeStore;
  chat: ChatStore;
  status: StatusStore;
}

export function createRenderStores(): RenderStores {
  return { runtime: new RuntimeStore(), chat: new ChatStore(), status: new StatusStore() };
}
