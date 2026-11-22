import { describe, expect, it } from 'vitest';
import type { ChatOp } from '../src/shared/chat';
import type { DataSourceRequest } from '../src/widgets/contract';
import type { Logger } from '../src/main/log';
import type { ChatSink } from '../src/main/providers/manager';
import {
  YouTubeChatAdapter,
  codeChallenge,
  type LoopbackFactory,
  type LoopbackHandler,
} from '../src/main/providers/youtube';
import { SecretStore } from '../src/main/store/secrets';
import { FakeTimers, fakeFetch, flush, type FetchCall, type FetchRouter } from './helpers';

const silentLog: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  registerSecret: () => undefined,
  redact: (text) => text,
};

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

function memorySecrets(initial: Record<string, unknown> = {}): SecretStore {
  const store = new SecretStore('', {
    isAvailable: () => false,
    encrypt: () => Buffer.alloc(0),
    decrypt: () => '',
  });
  for (const [key, value] of Object.entries(initial)) store.set(key, value);
  return store;
}

interface FakeLoopback {
  factory: LoopbackFactory;
  handler(): LoopbackHandler | null;
  closed(): boolean;
}

function fakeLoopback(): FakeLoopback {
  let handler: LoopbackHandler | null = null;
  let closed = false;
  return {
    factory: async (incoming) => {
      handler = incoming;
      return {
        port: 51234,
        close: () => {
          closed = true;
        },
      };
    },
    handler: () => handler,
    closed: () => closed,
  };
}

interface Harness {
  adapter: YouTubeChatAdapter;
  timers: FakeTimers;
  calls: FetchCall[];
  secrets: SecretStore;
  ops: ChatOp[];
  states: { key: string; state: string; detail?: string }[];
  sink: ChatSink;
  authUrls: string[];
  loopback: FakeLoopback;
}

function harness(router: FetchRouter, secrets: SecretStore): Harness {
  const timers = new FakeTimers();
  const { fetch, calls } = fakeFetch(router);
  const ops: ChatOp[] = [];
  const states: { key: string; state: string; detail?: string }[] = [];
  const sink: ChatSink = {
    ops: (incoming) => ops.push(...incoming),
    sourceState: (key, state, detail) => states.push({ key, state, ...(detail ? { detail } : {}) }),
  };
  const authUrls: string[] = [];
  const loopback = fakeLoopback();
  const adapter = new YouTubeChatAdapter({
    secrets,
    log: silentLog,
    openExternal: async (url) => {
      authUrls.push(url);
    },
    fetch,
    timers,
    loopback: loopback.factory,
  });
  return { adapter, timers, calls, secrets, ops, states, sink, authUrls, loopback };
}

function connectedSecrets(): SecretStore {
  return memorySecrets({
    'youtube.clientId': 'client-123.apps.googleusercontent.com',
    'youtube.clientSecret': 'secret-abc',
    'youtube.minPollMs': 5000,
    'youtube.tokens': {
      accessToken: 'yt-access',
      refreshToken: 'yt-refresh',
      expiresAt: 9_000_000,
      channelTitle: 'My Channel',
    },
  });
}

function baseRouter(extra?: FetchRouter): FetchRouter {
  return (call) => {
    const extraReply = extra?.(call);
    if (extraReply) return extraReply;
    if (call.url.startsWith('https://www.googleapis.com/youtube/v3/channels')) {
      return { status: 200, body: { items: [{ snippet: { title: 'My Channel' } }] } };
    }
    if (call.url.includes('/liveBroadcasts?') && call.url.includes('broadcastStatus=active')) {
      return {
        status: 200,
        body: {
          items: [
            { id: 'b1', snippet: { title: 'Live now', liveChatId: 'chat-1' }, status: { lifeCycleStatus: 'live' } },
          ],
        },
      };
    }
    if (call.url.includes('/videos?')) {
      return {
        status: 200,
        body: { items: [{ id: 'abcdefghijk', liveStreamingDetails: { activeLiveChatId: 'chat-1' } }] },
      };
    }
    return undefined;
  };
}

function chatItem(id: string, text: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    snippet: { type: 'textMessageEvent', publishedAt: '2026-11-22T10:00:00.000Z', displayMessage: text },
    authorDetails: { channelId: 'chan-1', displayName: 'Viewer', isChatModerator: true },
    ...extra,
  };
}

const VIDEO_REQ: DataSourceRequest = {
  kind: 'chat',
  provider: 'youtube',
  key: 'youtube:video:abcdefghijk',
  params: { videoId: 'abcdefghijk' },
};

const MINE_REQ: DataSourceRequest = { kind: 'chat', provider: 'youtube', key: 'youtube:mine', params: {} };

async function connectedAdapter(router: FetchRouter): Promise<Harness> {
  const h = harness(router, connectedSecrets());
  await flush();
  expect(h.adapter.status().state).toBe('connected');
  return h;
}

describe('YouTube loopback auth', () => {
  it('uses an S256 PKCE challenge derived from the verifier', async () => {
    const h = harness(
      (call) => {
        if (call.url === TOKEN_URL) {
          return { status: 200, body: { access_token: 'yt-access', refresh_token: 'yt-refresh', expires_in: 3600 } };
        }
        if (call.url.startsWith('https://www.googleapis.com/youtube/v3/channels')) {
          return { status: 200, body: { items: [{ snippet: { title: 'My Channel' } }] } };
        }
        return undefined;
      },
      memorySecrets({
        'youtube.clientId': 'client-123.apps.googleusercontent.com',
        'youtube.clientSecret': 'secret-abc',
      }),
    );
    await flush();
    await h.adapter.startAuth();
    expect(h.authUrls).toHaveLength(1);
    const url = new URL(h.authUrls[0]!);
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/youtube.readonly');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:51234');
    const challenge = url.searchParams.get('code_challenge')!;
    const state = url.searchParams.get('state')!;

    const html = h.loopback.handler()!(new URL(`http://127.0.0.1:51234?code=the-code&state=${state}`));
    expect(html).not.toContain('the-code');
    await flush();

    const tokenCall = h.calls.find((call) => call.url === TOKEN_URL)!;
    const body = new URLSearchParams(tokenCall.body);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('the-code');
    expect(codeChallenge(body.get('code_verifier')!)).toBe(challenge);
    expect(h.adapter.status().state).toBe('connected');
    expect(h.loopback.closed()).toBe(true);
  });

  it('rejects a callback whose state does not match', async () => {
    const h = harness(
      () => undefined,
      memorySecrets({
        'youtube.clientId': 'client-123.apps.googleusercontent.com',
        'youtube.clientSecret': 'secret-abc',
      }),
    );
    await flush();
    await h.adapter.startAuth();
    const url = new URL(h.authUrls[0]!);
    const redirect = url.searchParams.get('redirect_uri')!;
    const html = h.loopback.handler()!(new URL(`${redirect}?code=the-code&state=wrong-state`));
    expect(html).not.toContain('wrong-state');
    await flush();
    expect(h.calls.some((call) => call.url === TOKEN_URL)).toBe(false);
    expect(h.adapter.status().state).toBe('authorizing');
  });
});

describe('YouTube live chat polling', () => {
  it('waits at least the configured minimum between polls', async () => {
    let polls = 0;
    const h = await connectedAdapter(
      baseRouter((call) => {
        if (!call.url.includes('/liveChat/messages?')) return undefined;
        polls += 1;
        return {
          status: 200,
          body: { pollingIntervalMillis: 1000, nextPageToken: `page-${polls}`, items: [chatItem(`m${polls}`, `hello ${polls}`)] },
        };
      }),
    );
    h.adapter.start(VIDEO_REQ, h.sink);
    await flush();
    expect(polls).toBe(1);
    expect(h.states.at(-1)).toEqual({ key: 'youtube:video:abcdefghijk', state: 'live' });

    await h.timers.advance(4000);
    expect(polls).toBe(1);
    await h.timers.advance(1000);
    expect(polls).toBe(2);
    const second = h.calls.filter((call) => call.url.includes('/liveChat/messages?'))[1]!;
    expect(second.url).toContain('pageToken=page-1');
  });

  it('trims the first backlog to the last twenty messages', async () => {
    const h = await connectedAdapter(
      baseRouter((call) => {
        if (!call.url.includes('/liveChat/messages?')) return undefined;
        const items = Array.from({ length: 30 }, (_, index) => chatItem(`m${index}`, `line ${index}`));
        return { status: 200, body: { pollingIntervalMillis: 5000, items } };
      }),
    );
    h.adapter.start(VIDEO_REQ, h.sink);
    await flush();
    const adds = h.ops.filter((op) => op.t === 'add');
    expect(adds).toHaveLength(20);
    if (adds[0]?.t !== 'add') return;
    expect(adds[0].message.id).toBe('yt:m10');
  });

  it('maps deleted and banned events to ops', async () => {
    const h = await connectedAdapter(
      baseRouter((call) => {
        if (!call.url.includes('/liveChat/messages?')) return undefined;
        return {
          status: 200,
          body: {
            pollingIntervalMillis: 5000,
            items: [
              chatItem('m1', 'hello'),
              { id: 'm2', snippet: { type: 'messageDeletedEvent', deletedMessageDetails: { deletedMessageId: 'm1' } } },
              { id: 'm3', snippet: { type: 'userBannedEvent', userBannedDetails: { bannedUserDetails: { channelId: 'chan-9' } } } },
            ],
          },
        };
      }),
    );
    h.adapter.start(VIDEO_REQ, h.sink);
    await flush();
    expect(h.ops).toEqual([
      expect.objectContaining({ t: 'add', sourceKey: 'youtube:video:abcdefghijk' }),
      { t: 'delete', sourceKey: 'youtube:video:abcdefghijk', messageId: 'yt:m1' },
      { t: 'clearUser', sourceKey: 'youtube:video:abcdefghijk', authorId: 'chan-9' },
    ]);
  });

  it('stops polling with an error state when the daily quota is exhausted', async () => {
    let polls = 0;
    const h = await connectedAdapter(
      baseRouter((call) => {
        if (!call.url.includes('/liveChat/messages?')) return undefined;
        polls += 1;
        if (polls === 1) {
          return { status: 200, body: { pollingIntervalMillis: 5000, items: [chatItem('m1', 'hello')] } };
        }
        return { status: 403, body: { error: { errors: [{ reason: 'quotaExceeded' }], status: 'PERMISSION_DENIED' } } };
      }),
    );
    h.adapter.start(VIDEO_REQ, h.sink);
    await flush();
    await h.timers.advance(5000);
    expect(polls).toBe(2);
    expect(h.adapter.status().state).toBe('error');
    expect(h.adapter.status().message).toBe(
      'YouTube API daily quota exhausted — resets at midnight Pacific time',
    );
    await h.timers.advance(60_000);
    expect(polls).toBe(2);
  });

  it('shares one poller when two sources resolve to the same live chat', async () => {
    let polls = 0;
    const h = await connectedAdapter(
      baseRouter((call) => {
        if (!call.url.includes('/liveChat/messages?')) return undefined;
        polls += 1;
        return { status: 200, body: { pollingIntervalMillis: 5000, items: [chatItem(`m${polls}`, 'hello')] } };
      }),
    );
    h.adapter.start(MINE_REQ, h.sink);
    h.adapter.start(VIDEO_REQ, h.sink);
    await flush();
    expect(polls).toBe(1);
    expect(h.ops.filter((op) => op.t === 'add')).toHaveLength(2);

    await h.timers.advance(5000);
    expect(polls).toBe(2);
    expect(h.ops.filter((op) => op.t === 'add')).toHaveLength(4);
  });

  it('keeps tokens and the client secret out of status and settings', async () => {
    const h = await connectedAdapter(
      baseRouter((call) => {
        if (!call.url.includes('/liveChat/messages?')) return undefined;
        return { status: 200, body: { pollingIntervalMillis: 5000, items: [] } };
      }),
    );
    h.adapter.start(VIDEO_REQ, h.sink);
    await flush();
    const status = JSON.stringify(h.adapter.status());
    expect(status).not.toContain('yt-access');
    expect(status).not.toContain('yt-refresh');
    expect(status).not.toContain('secret-abc');
    expect(status).not.toContain('client-123');
    expect(h.secrets.get('youtube.clientSecret')).toBe('secret-abc');
  });
});
