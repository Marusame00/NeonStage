import type { ProviderTimers } from '../src/main/providers/deps';

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.freeze(value);
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

export async function flush(times = 6): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

export class FakeTimers implements ProviderTimers {
  private seq = 0;
  private time = 1_000_000;
  private readonly timeouts = new Map<number, { at: number; handler: () => void }>();
  private readonly intervals = new Map<number, { every: number; handler: () => void; next: number }>();

  setTimeout(handler: () => void, ms: number): unknown {
    this.seq += 1;
    this.timeouts.set(this.seq, { at: this.time + ms, handler });
    return this.seq;
  }

  clearTimeout(handle: unknown): void {
    if (typeof handle === 'number') this.timeouts.delete(handle);
  }

  setInterval(handler: () => void, ms: number): unknown {
    this.seq += 1;
    this.intervals.set(this.seq, { every: ms, handler, next: this.time + ms });
    return this.seq;
  }

  clearInterval(handle: unknown): void {
    if (typeof handle === 'number') this.intervals.delete(handle);
  }

  now(): number {
    return this.time;
  }

  pendingTimeouts(): number {
    return this.timeouts.size;
  }

  async advance(ms: number): Promise<void> {
    const target = this.time + ms;
    for (let guard = 0; guard < 500; guard += 1) {
      const next = this.nextDue(target);
      if (!next) break;
      this.time = next.at;
      if (next.kind === 'timeout') {
        this.timeouts.delete(next.id);
        next.handler();
      } else {
        const entry = this.intervals.get(next.id);
        if (!entry) continue;
        entry.next = this.time + entry.every;
        entry.handler();
      }
      await flush();
    }
    this.time = target;
    await flush();
  }

  private nextDue(
    target: number,
  ): { id: number; at: number; kind: 'timeout' | 'interval'; handler: () => void } | null {
    let best: { id: number; at: number; kind: 'timeout' | 'interval'; handler: () => void } | null =
      null;
    for (const [id, entry] of this.timeouts) {
      if (entry.at > target) continue;
      if (!best || entry.at < best.at) {
        best = { id, at: entry.at, kind: 'timeout', handler: entry.handler };
      }
    }
    for (const [id, entry] of this.intervals) {
      if (entry.next > target) continue;
      if (!best || entry.next < best.at) {
        best = { id, at: entry.next, kind: 'interval', handler: entry.handler };
      }
    }
    return best;
  }
}

export interface FetchCall {
  url: string;
  method: string;
  body: string;
  headers: Record<string, string>;
}

export type FetchReply = { status: number; body?: unknown };
export type FetchRouter = (call: FetchCall) => FetchReply | undefined;

export function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

export function fakeFetch(router: FetchRouter): { fetch: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const impl = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
      headers[key.toLowerCase()] = value;
    }
    const call: FetchCall = {
      url,
      method: (init?.method ?? 'GET').toUpperCase(),
      body: typeof init?.body === 'string' ? init.body : '',
      headers,
    };
    calls.push(call);
    const reply = router(call);
    if (!reply) throw new Error(`unexpected request ${call.method} ${url}`);
    return jsonResponse(reply.status, reply.body ?? {});
  }) as unknown as typeof fetch;
  return { fetch: impl, calls };
}
