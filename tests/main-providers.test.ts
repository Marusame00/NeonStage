import { describe, expect, it } from 'vitest';
import type { ChatOp } from '../src/shared/chat';
import { createEmptyProject, type ProjectDoc } from '../src/shared/model';
import { addNode, createWidgetNode } from '../src/shared/ops';
import type { DataSourceRequest } from '../src/widgets/contract';
import { DemoChatAdapter } from '../src/main/providers/demo';
import { ProviderManager, type ChatAdapter, type ChatSink } from '../src/main/providers/manager';
import { WidgetRuntimeHost } from '../src/main/runtime/widgetRuntimeHost';

class FakeAdapter implements ChatAdapter {
  starts: string[] = [];
  stops: string[] = [];
  disposed = false;

  start(req: DataSourceRequest, sink: ChatSink): void {
    this.starts.push(req.key);
    sink.sourceState(req.key, 'live');
  }

  stop(key: string): void {
    this.stops.push(key);
  }

  status(): null {
    return null;
  }

  dispose(): void {
    this.disposed = true;
  }
}

function docWithChats(count: number): ProjectDoc {
  const base = createEmptyProject('Providers');
  let scene = base.scenes[0]!;
  for (let index = 0; index < count; index += 1) {
    scene = addNode(
      scene,
      createWidgetNode('chat-twitch', 0, index * 200, {
        props: { source: 'live', channel: 'mychannel' },
      }),
    );
  }
  return { ...base, scenes: [scene] };
}

describe('ProviderManager ref counting', () => {
  it('shares one connection for identical keys and releases it once', () => {
    const manager = new ProviderManager();
    const adapter = new FakeAdapter();
    manager.registerAdapter('twitch', adapter);
    const host = new WidgetRuntimeHost(manager);

    const two = docWithChats(2);
    host.sync([two, two]);
    expect(manager.refCount('twitch:mychannel')).toBe(1);
    expect(adapter.starts).toEqual(['twitch:mychannel']);

    host.sync([docWithChats(1), docWithChats(1)]);
    expect(manager.refCount('twitch:mychannel')).toBe(1);
    expect(adapter.stops).toEqual([]);

    const ops: ChatOp[] = [];
    manager.on('chat', (incoming: ChatOp[]) => ops.push(...incoming));
    host.sync([docWithChats(0), docWithChats(0)]);
    expect(adapter.stops).toEqual(['twitch:mychannel']);
    expect(ops).toContainEqual({ t: 'clear', sourceKey: 'twitch:mychannel' });
    expect(manager.refCount('twitch:mychannel')).toBe(0);

    host.sync([two, two]);
    expect(manager.refCount('twitch:mychannel')).toBe(1);
    host.dispose();
    expect(manager.refCount('twitch:mychannel')).toBe(0);
    expect(adapter.stops).toEqual(['twitch:mychannel', 'twitch:mychannel']);

    manager.dispose();
    expect(adapter.disposed).toBe(true);
  });
});

describe('DemoChatAdapter', () => {
  it('emits labelled sample messages and never reports a live status', () => {
    const handlers: (() => void)[] = [];
    const adapter = new DemoChatAdapter('twitch', {
      setInterval: (handler) => {
        handlers.push(handler);
        return handlers.length - 1;
      },
      clearInterval: () => undefined,
    });

    const ops: ChatOp[] = [];
    const states: string[] = [];
    adapter.start(
      { kind: 'chat', provider: 'demo-twitch', key: 'demo:twitch', params: {} },
      {
        ops: (incoming) => ops.push(...incoming),
        sourceState: (_key, state) => states.push(state),
      },
    );

    expect(ops.length).toBeGreaterThanOrEqual(3);
    for (const op of ops) {
      expect(op.t).toBe('add');
      if (op.t === 'add') {
        expect(op.message.demo).toBe(true);
        expect(op.message.platform).toBe('twitch');
        expect(op.message.sourceKey).toBe('demo:twitch');
      }
    }
    expect(states).toEqual(['demo']);
    expect(adapter.status()).toBeNull();

    expect(handlers).toHaveLength(1);
    handlers[0]!();
    expect(ops.length).toBeGreaterThanOrEqual(4);
    adapter.dispose();
  });
});
