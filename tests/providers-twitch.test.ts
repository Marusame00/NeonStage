import { describe, expect, it } from 'vitest';
import type { ChatOp } from '../src/shared/chat';
import { createEmptyProject } from '../src/shared/model';
import { addNode, createWidgetNode } from '../src/shared/ops';
import type { DataSourceRequest } from '../src/widgets/contract';
import type { Logger } from '../src/main/log';
import type { WsLike } from '../src/main/providers/deps';
import { ProviderManager, type ChatSink } from '../src/main/providers/manager';
import { TwitchChatAdapter } from '../src/main/providers/twitch';
import { WidgetRuntimeHost } from '../src/main/runtime/widgetRuntimeHost';
import { SecretStore } from '../src/main/store/secrets';
import { FakeTimers, fakeFetch, flush, type FetchCall, type FetchRouter } from './helpers';

const silentLog: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  registerSecret: () => undefined,
  redact: (text) => text,
};

function memorySecrets(initial: Record<string, unknown> = {}): SecretStore {
  const store = new SecretStore('', {
    isAvailable: () => false,
    encrypt: () => Buffer.alloc(0),
    decrypt: () => '',
  });
  for (const [key, value] of Object.entries(initial)) store.set(key, value);
  return store;
}

class FakeWs implements WsLike {
  readonly sent: string[] = [];
  closed = false;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(readonly url: string) {}

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }

  emit(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  drop(): void {
    this.onclose?.({});
  }
}

function welcome(sessionId: string, keepalive = 10): unknown {
  return {
    metadata: { message_type: 'session_welcome' },
    payload: { session: { id: sessionId, keepalive_timeout_seconds: keepalive } },
  };
}

function notification(type: string, event: Record<string, unknown>): unknown {
  return {
    metadata: { message_type: 'notification' },
    payload: { subscription: { type, id: `sub-${type}` }, event },
  };
}

interface Harness {
  adapter: TwitchChatAdapter;
  timers: FakeTimers;
  sockets: FakeWs[];
  calls: FetchCall[];
  secrets: SecretStore;
  ops: ChatOp[];
  states: { key: string; state: string; detail?: string }[];
  sink: ChatSink;
}

function harness(router: FetchRouter, secrets: SecretStore): Harness {
  const timers = new FakeTimers();
  const sockets: FakeWs[] = [];
  const { fetch, calls } = fakeFetch(router);
  const ops: ChatOp[] = [];
  const states: { key: string; state: string; detail?: string }[] = [];
  const sink: ChatSink = {
    ops: (incoming) => ops.push(...incoming),
    sourceState: (key, state, detail) => states.push({ key, state, ...(detail ? { detail } : {}) }),
  };
  const adapter = new TwitchChatAdapter({
    secrets,
    log: silentLog,
    openExternal: async () => undefined,
    fetch,
    timers,
    ws: (url) => {
      const ws = new FakeWs(url);
      sockets.push(ws);
      return ws;
    },
  });
  return { adapter, timers, sockets, calls, secrets, ops, states, sink };
}

const CHANNEL_REQ: DataSourceRequest = {
  kind: 'chat',
  provider: 'twitch',
  key: 'twitch:mychannel',
  params: { channel: 'mychannel' },
};

function helixRouter(extra?: FetchRouter): FetchRouter {
  return (call) => {
    const extraReply = extra?.(call);
    if (extraReply) return extraReply;
    if (call.url === 'https://id.twitch.tv/oauth2/validate') {
      return { status: 200, body: { login: 'streamer', user_id: '99' } };
    }
    if (call.url.includes('/helix/users?login=mychannel')) return { status: 200, body: { data: [{ id: '42' }] } };
    if (call.url.includes('/helix/chat/badges/global')) {
      return {
        status: 200,
        body: {
          data: [
            {
              set_id: 'subscriber',
              versions: [
                {
                  id: '12',
                  image_url_1x: 'https://static-cdn.jtvnw.net/badges/v1/sub/1',
                  title: 'Subscriber',
                },
              ],
            },
          ],
        },
      };
    }
    if (call.url.includes('/helix/chat/badges?broadcaster_id=42')) return { status: 200, body: { data: [] } };
    if (call.url.endsWith('/helix/eventsub/subscriptions') && call.method === 'POST') {
      const parsed = JSON.parse(call.body) as { type: string };
      return { status: 202, body: { data: [{ id: `sub-${parsed.type}` }] } };
    }
    if (call.url.includes('/helix/eventsub/subscriptions?id=') && call.method === 'DELETE') {
      return { status: 204, body: {} };
    }
    return undefined;
  };
}

function connectedSecrets(): SecretStore {
  return memorySecrets({
    'twitch.clientId': 'abcdef1234567890',
    'twitch.tokens': {
      accessToken: 'token-1',
      refreshToken: 'refresh-1',
      expiresAt: 9_000_000,
      userId: '99',
      login: 'streamer',
    },
  });
}

async function connectedAdapter(router: FetchRouter): Promise<Harness> {
  const h = harness(router, connectedSecrets());
  await flush();
  expect(h.adapter.status().state).toBe('connected');
  return h;
}

async function liveChannel(h: Harness): Promise<void> {
  h.adapter.start(CHANNEL_REQ, h.sink);
  await flush();
  expect(h.sockets).toHaveLength(1);
  h.sockets[0]!.emit(welcome('sess-1'));
  await flush();
}

describe('Twitch device code flow', () => {
  it('polls through authorization_pending and slow_down before success', async () => {
    const secrets = memorySecrets({ 'twitch.clientId': 'abcdef1234567890' });
    let tokenPolls = 0;
    const h = harness((call) => {
      if (call.url === 'https://id.twitch.tv/oauth2/device') {
        return {
          status: 200,
          body: {
            device_code: 'dev-1',
            user_code: 'ABCD-1234',
            verification_uri: 'https://www.twitch.tv/activate',
            expires_in: 1800,
            interval: 5,
          },
        };
      }
      if (call.url === 'https://id.twitch.tv/oauth2/token') {
        tokenPolls += 1;
        if (tokenPolls === 1) return { status: 400, body: { message: 'authorization_pending' } };
        if (tokenPolls === 2) return { status: 400, body: { message: 'slow_down' } };
        return {
          status: 200,
          body: {
            access_token: 'token-9',
            refresh_token: 'refresh-9',
            expires_in: 3600,
            scope: ['user:read:chat'],
            token_type: 'bearer',
          },
        };
      }
      if (call.url === 'https://id.twitch.tv/oauth2/validate') {
        return { status: 200, body: { client_id: 'abcdef1234567890', login: 'streamer', user_id: '99', scopes: ['user:read:chat'], expires_in: 3600 } };
      }
      return undefined;
    }, secrets);
    await flush();

    const prompt = await h.adapter.startAuth();
    expect(prompt.userCode).toBe('ABCD-1234');
    expect(prompt.verificationUri).toBe('https://www.twitch.tv/activate');
    expect(prompt.expiresAt).toBeGreaterThan(h.timers.now());
    expect(h.adapter.status().state).toBe('authorizing');

    await h.timers.advance(5000);
    expect(tokenPolls).toBe(1);
    expect(h.adapter.status().state).toBe('authorizing');

    await h.timers.advance(5000);
    expect(tokenPolls).toBe(2);

    await h.timers.advance(5000);
    expect(tokenPolls).toBe(2);

    await h.timers.advance(5000);
    expect(tokenPolls).toBe(3);
    expect(h.adapter.status().state).toBe('connected');
    expect(h.adapter.status().account).toBe('streamer');
    expect(secrets.get<{ refreshToken: string }>('twitch.tokens')?.refreshToken).toBe('refresh-9');
  });
});

describe('Twitch token refresh', () => {
  it('stores the rotated single-use refresh token', async () => {
    const secrets = memorySecrets({
      'twitch.clientId': 'abcdef1234567890',
      'twitch.tokens': {
        accessToken: 'stale',
        refreshToken: 'refresh-old',
        expiresAt: 1,
        userId: '99',
        login: 'streamer',
      },
    });
    const h = harness((call) => {
      if (call.url === 'https://id.twitch.tv/oauth2/token') {
        expect(call.body).toContain('grant_type=refresh_token');
        expect(call.body).toContain('refresh_token=refresh-old');
        return { status: 200, body: { access_token: 'fresh', refresh_token: 'refresh-new', expires_in: 3600 } };
      }
      if (call.url === 'https://id.twitch.tv/oauth2/validate') {
        return { status: 200, body: { login: 'streamer', user_id: '99' } };
      }
      return undefined;
    }, secrets);
    await flush();
    const stored = secrets.get<{ accessToken: string; refreshToken: string }>('twitch.tokens');
    expect(stored?.accessToken).toBe('fresh');
    expect(stored?.refreshToken).toBe('refresh-new');
    expect(h.adapter.status().state).toBe('connected');
  });

  it('falls back to anonymous mode when refresh is rejected', async () => {
    const secrets = memorySecrets({
      'twitch.clientId': 'abcdef1234567890',
      'twitch.tokens': {
        accessToken: 'stale',
        refreshToken: 'refresh-old',
        expiresAt: 1,
        userId: '99',
        login: 'streamer',
      },
    });
    const h = harness((call) => {
      if (call.url === 'https://id.twitch.tv/oauth2/token') return { status: 400, body: { message: 'Invalid refresh token' } };
      return undefined;
    }, secrets);
    await flush();
    expect(h.adapter.status().state).toBe('connected');
    expect(h.adapter.status().mode).toBe('anonymous');
    expect(h.adapter.status().message).toBe(
      'Reading chat anonymously — just enter a channel name. Sign-in is optional.',
    );
    expect(secrets.get('twitch.tokens')).toBeNull();
  });
});

describe('Twitch EventSub session', () => {
  it('creates all four subscriptions for the broadcaster on welcome', async () => {
    const h = await connectedAdapter(helixRouter());
    await liveChannel(h);
    const posts = h.calls.filter((call) => call.method === 'POST' && call.url.endsWith('/eventsub/subscriptions'));
    expect(posts).toHaveLength(4);
    const bodies = posts.map((call) => JSON.parse(call.body) as {
      type: string;
      version: string;
      condition: Record<string, string>;
      transport: Record<string, string>;
    });
    expect(bodies.map((body) => body.type).sort()).toEqual([
      'channel.chat.clear',
      'channel.chat.clear_user_messages',
      'channel.chat.message',
      'channel.chat.message_delete',
    ]);
    for (const body of bodies) {
      expect(body.version).toBe('1');
      expect(body.condition).toEqual({ broadcaster_user_id: '42', user_id: '99' });
      expect(body.transport).toEqual({ method: 'websocket', session_id: 'sess-1' });
    }
    expect(h.states.at(-1)).toEqual({ key: 'twitch:mychannel', state: 'live' });
  });

  it('maps chat messages with emote urls and sanitized text', async () => {
    const h = await connectedAdapter(helixRouter());
    await liveChannel(h);
    h.sockets[0]!.emit(
      notification('channel.chat.message', {
        message_id: 'msg-1',
        chatter_user_id: '7',
        chatter_user_login: 'viewer',
        chatter_user_name: 'Viewer',
        broadcaster_user_id: '42',
        color: '#FF00AA',
        message_type: 'text',
        badges: [{ set_id: 'subscriber', id: '12' }],
        message: {
          text: 'hello Kappa',
          fragments: [
            { type: 'text', text: 'hello ' },
            { type: 'emote', text: 'Kappa', emote: { id: '25' } },
          ],
        },
      }),
    );
    await flush();
    const add = h.ops.find((op) => op.t === 'add');
    expect(add).toBeDefined();
    if (add?.t !== 'add') return;
    expect(add.message.id).toBe('tw:msg-1');
    expect(add.message.platform).toBe('twitch');
    expect(add.message.author.name).toBe('Viewer');
    expect(add.message.author.color).toBe('#FF00AA');
    expect(add.message.author.badges).toEqual([
      {
        id: 'subscriber',
        label: 'Subscriber',
        imageUrl: 'https://static-cdn.jtvnw.net/badges/v1/sub/1',
      },
    ]);
    expect(add.message.segments).toEqual([
      { t: 'text', text: 'hello ' },
      {
        t: 'emote',
        id: '25',
        name: 'Kappa',
        url: 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/1.0',
      },
    ]);
    expect(add.message.kind).toBe('message');
  });

  it('maps delete, clear and clear-user notifications to ops', async () => {
    const h = await connectedAdapter(helixRouter());
    await liveChannel(h);
    h.sockets[0]!.emit(
      notification('channel.chat.message_delete', { broadcaster_user_id: '42', target_user_id: '7', message_id: 'msg-1' }),
    );
    h.sockets[0]!.emit(notification('channel.chat.clear_user_messages', { broadcaster_user_id: '42', target_user_id: '7' }));
    h.sockets[0]!.emit(notification('channel.chat.clear', { broadcaster_user_id: '42' }));
    await flush();
    expect(h.ops).toEqual([
      { t: 'delete', sourceKey: 'twitch:mychannel', messageId: 'tw:msg-1' },
      { t: 'clearUser', sourceKey: 'twitch:mychannel', authorId: '7' },
      { t: 'clear', sourceKey: 'twitch:mychannel' },
    ]);
  });

  it('keeps subscriptions when Twitch asks for a reconnect', async () => {
    const h = await connectedAdapter(helixRouter());
    await liveChannel(h);
    const before = h.calls.filter((call) => call.method === 'POST' && call.url.endsWith('/eventsub/subscriptions')).length;
    expect(before).toBe(4);

    h.sockets[0]!.emit({
      metadata: { message_type: 'session_reconnect' },
      payload: { session: { id: 'sess-1', reconnect_url: 'wss://eventsub.wss.twitch.tv/ws?reconnect=1' } },
    });
    await flush();
    expect(h.sockets).toHaveLength(2);
    expect(h.sockets[1]!.url).toBe('wss://eventsub.wss.twitch.tv/ws?reconnect=1');
    expect(h.sockets[0]!.closed).toBe(false);

    h.sockets[1]!.emit(welcome('sess-2'));
    await flush();
    expect(h.sockets[0]!.closed).toBe(true);
    const after = h.calls.filter((call) => call.method === 'POST' && call.url.endsWith('/eventsub/subscriptions')).length;
    expect(after).toBe(4);
    expect(h.adapter.status().state).toBe('connected');
  });

  it('reconnects from scratch when the keepalive watchdog expires', async () => {
    const h = await connectedAdapter(helixRouter());
    await liveChannel(h);
    expect(h.sockets).toHaveLength(1);

    await h.timers.advance(15_000);
    expect(h.sockets[0]!.closed).toBe(true);
    expect(h.adapter.status().state).toBe('reconnecting');

    await h.timers.advance(2000);
    expect(h.sockets).toHaveLength(2);
    h.sockets[1]!.emit(welcome('sess-2'));
    await flush();
    expect(h.adapter.status().state).toBe('connected');
  });
});

describe('Twitch shared session through the manager', () => {
  function docWithChats(count: number) {
    const base = createEmptyProject('Twitch');
    let scene = base.scenes[0]!;
    for (let index = 0; index < count; index += 1) {
      scene = addNode(
        scene,
        createWidgetNode('chat-twitch', 0, index * 200, { props: { source: 'live', channel: 'mychannel' } }),
      );
    }
    return { ...base, scenes: [scene] };
  }

  it('shares one socket and one subscription set, then deletes on release', async () => {
    const secrets = connectedSecrets();
    const timers = new FakeTimers();
    const sockets: FakeWs[] = [];
    const { fetch, calls } = fakeFetch(helixRouter());
    const manager = new ProviderManager();
    const adapter = new TwitchChatAdapter({
      secrets,
      log: silentLog,
      openExternal: async () => undefined,
      fetch,
      timers,
      ws: (url) => {
        const ws = new FakeWs(url);
        sockets.push(ws);
        return ws;
      },
    });
    manager.registerAdapter('twitch', adapter);
    const host = new WidgetRuntimeHost(manager);
    await flush();

    const two = docWithChats(2);
    host.sync([two, two]);
    await flush();
    expect(manager.refCount('twitch:mychannel')).toBe(1);
    expect(sockets).toHaveLength(1);
    sockets[0]!.emit(welcome('sess-1'));
    await flush();
    const posts = calls.filter((call) => call.method === 'POST' && call.url.endsWith('/eventsub/subscriptions'));
    expect(posts).toHaveLength(4);

    host.sync([docWithChats(0), docWithChats(0)]);
    await flush();
    const deletes = calls.filter((call) => call.method === 'DELETE');
    expect(deletes).toHaveLength(4);
    expect(manager.refCount('twitch:mychannel')).toBe(0);
    host.dispose();
    manager.dispose();
  });
});
