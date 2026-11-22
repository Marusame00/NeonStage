import { EventEmitter } from 'node:events';
import {
  toBroadcastSafe,
  type BroadcastSafeStatus,
  type ChatOp,
  type ProviderStatus,
  type SourceState,
} from '../../shared/chat';
import type { DataSourceRequest } from '../../widgets/contract';

export interface ChatSink {
  ops(ops: ChatOp[]): void;
  sourceState(key: string, state: SourceState, detail?: string): void;
}

export interface ChatAdapter {
  start(req: DataSourceRequest, sink: ChatSink): void;
  stop(key: string): void;
  status(): ProviderStatus | null;
  reconnect?(): Promise<void>;
  dispose(): void;
}

interface Entry {
  req: DataSourceRequest;
  count: number;
  adapter: ChatAdapter | null;
}

interface SourceStateEntry {
  state: SourceState;
  detail?: string;
}

export class ProviderManager extends EventEmitter {
  private readonly adapters = new Map<string, ChatAdapter>();
  private readonly entries = new Map<string, Entry>();
  private readonly sourceStates = new Map<string, SourceStateEntry>();
  private readonly sink: ChatSink = {
    ops: (ops) => {
      if (ops.length > 0) this.emit('chat', ops);
    },
    sourceState: (key, state, detail) => {
      this.sourceStates.set(key, detail ? { state, detail } : { state });
      this.emit('status', this.getStatuses());
    },
  };

  registerAdapter(name: string, adapter: ChatAdapter): void {
    this.adapters.set(name, adapter);
    this.emit('status', this.getStatuses());
  }

  notifyStatus(): void {
    this.emit('status', this.getStatuses());
  }

  adapter(name: string): ChatAdapter | null {
    return this.adapters.get(name) ?? null;
  }

  acquire(req: DataSourceRequest): () => void {
    const key = req.key;
    const existing = this.entries.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      const adapter = this.adapters.get(req.provider) ?? null;
      this.entries.set(key, { req, count: 1, adapter });
      adapter?.start(req, this.sink);
      this.emit('status', this.getStatuses());
    }

    let released = false;
    return () => {
      if (released) return;
      released = true;
      const entry = this.entries.get(key);
      if (!entry) return;
      entry.count -= 1;
      if (entry.count > 0) return;
      this.entries.delete(key);
      entry.adapter?.stop(key);
      this.sourceStates.delete(key);
      this.emit('chat', [{ t: 'clear', sourceKey: key }] satisfies ChatOp[]);
      this.emit('status', this.getStatuses());
    };
  }

  refCount(key: string): number {
    return this.entries.get(key)?.count ?? 0;
  }

  activeKeys(): string[] {
    return [...this.entries.keys()];
  }

  getStatuses(): ProviderStatus[] {
    const out: ProviderStatus[] = [];
    for (const adapter of this.adapters.values()) {
      const status = adapter.status();
      if (!status) continue;
      out.push({
        ...status,
        sources: status.sources.map((source) => {
          const override = this.sourceStates.get(source.key);
          if (!override) return source;
          return {
            key: source.key,
            state: override.state,
            ...(override.detail ? { detail: override.detail } : {}),
          };
        }),
      });
    }
    return out;
  }

  getBroadcastStatus(): BroadcastSafeStatus {
    const safe = toBroadcastSafe(this.getStatuses());
    for (const [key, entry] of this.sourceStates) safe[key] = entry.state;
    return safe;
  }

  dispose(): void {
    for (const [key, entry] of [...this.entries]) {
      entry.adapter?.stop(key);
      this.entries.delete(key);
    }
    this.sourceStates.clear();
    for (const adapter of this.adapters.values()) adapter.dispose();
    this.adapters.clear();
    this.emit('status', this.getStatuses());
  }
}
