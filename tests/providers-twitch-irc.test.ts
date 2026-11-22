import { describe, expect, it } from 'vitest';
import type { ChatOp } from '../src/shared/chat';
import type { Logger } from '../src/main/log';
import type { WsLike } from '../src/main/providers/deps';
import type { ChatSink } from '../src/main/providers/manager';
import { TwitchChatAdapter } from '../src/main/providers/twitch';
import {
  IRC_URL,
  TwitchIrcReader,
  normalizeChannel,
  parseEmoteTag,
  parseIrcLine,
  segmentText,
  unescapeTag,
  type TwitchIrcHandlers,
} from '../src/main/providers/twitchIrc';
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

  open(): void {
    this.onopen?.({});
  }

  line(text: string): void {
    this.onmessage?.({ data: `${text}\r\n` });
  }

  emit(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  drop(): void {
    this.onclose?.({});
  }
}

function readerHarness(): {
  reader: TwitchIrcReader;
  timers: FakeTimers;
  sockets: FakeWs[];
  events: string[];
} {
  const timers = new FakeTimers();
  const sockets: FakeWs[] = [];
  const events: string[] = [];
  const reader = new TwitchIrcReader({
    timers,
    ws: (url) => {
      const ws = new FakeWs(url);
      sockets.push(ws);
      return ws;
    },
  });
  return { reader, timers, sockets, events };
}

function handlers(events: string[], extra: TwitchIrcHandlers = {}): TwitchIrcHandlers {
  return {
    joined: () => events.push('joined'),
    clearAll: () => events.push('clear-all'),
    clearUser: (authorId) => events.push(`clear-user:${authorId}`),
    deleteMessage: (messageId) => events.push(`delete:${messageId}`),
    error: (detail) => events.push(`error:${detail}`),
    message: (message) => events.push(`message:${message.kind}:${message.id}`),
    notice: (message) => events.push(`notice:${message.segments[0]?.t === 'text' ? message.segments[0].text : ''}`),
    ...extra,
  };
}

describe('Twitch IRC parsing', () => {
  it('unescapes tag values and splits an IRC line', () => {
    expect(unescapeTag('a\\sb\\:c\\\\d\\re\\nf')).toBe('a b;c\\d\re\nf');
    const line = parseIrcLine(
      '@badge-info=;color=#FF00AA;display-name=Some\\sUser :viewer!viewer@viewer.tmi.twitch.tv PRIVMSG #chan :hello world',
    );
    expect(line).not.toBeNull();
    expect(line?.tags['display-name']).toBe('Some User');
    expect(line?.tags['color']).toBe('#FF00AA');
    expect(line?.prefix).toBe('viewer!viewer@viewer.tmi.twitch.tv');
    expect(line?.command).toBe('PRIVMSG');
    expect(line?.params).toEqual(['#chan', 'hello world']);
  });

  it('normalises channel names and links', () => {
    expect(normalizeChannel('https://www.twitch.tv/Name')).toBe('name');
    expect(normalizeChannel('twitch.tv/name')).toBe('name');
    expect(normalizeChannel('#name')).toBe('name');
    expect(normalizeChannel(' Name ')).toBe('name');
    expect(normalizeChannel('')).toBe('');
  });

  it('segments emotes by code point, including a surrogate pair before the emote', () => {
    const text = '😀 Kappa';
    expect(text.length).toBe(8);
    const segments = segmentText(text, parseEmoteTag('25:2-6'));
    expect(segments).toEqual([
      { t: 'text', text: '😀 ' },
      {
        t: 'emote',
        id: '25',
        name: 'Kappa',
        url: 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/1.0',
      },
    ]);
  });

  it('splits several emotes and keeps the text between them', () => {
    const segments = segmentText('a Kappa b PogChamp', parseEmoteTag('25:2-6/88:10-17'));
    expect(segments.map((segment) => segment.t)).toEqual(['text', 'emote', 'text', 'emote']);
    expect(segments[1]).toMatchObject({ t: 'emote', name: 'Kappa' });
    expect(segments[3]).toMatchObject({ t: 'emote', name: 'PogChamp' });
  });
});

describe('Twitch IRC reader', () => {
  it('sends the anonymous handshake and joins on open', () => {
    const h = readerHarness();
    h.reader.join('MyChannel', handlers(h.events));
    expect(h.sockets).toHaveLength(1);
    expect(h.sockets[0]!.url).toBe(IRC_URL);
    h.sockets[0]!.open();
    expect(h.sockets[0]!.sent).toEqual([
      'CAP REQ :twitch.tv/tags twitch.tv/commands\r\n',
      'PASS SCHMOOPIIE\r\n',
      expect.stringMatching(/^NICK justinfan\d{5}\r\n$/),
      'JOIN #mychannel\r\n',
    ]);
    h.reader.dispose();
  });

  it('answers PING and reports a confirmed join once', () => {
    const h = readerHarness();
    h.reader.join('mychannel', handlers(h.events));
    const ws = h.sockets[0]!;
    ws.open();
    ws.line('PING :tmi.twitch.tv');
    expect(ws.sent.at(-1)).toBe('PONG :tmi.twitch.tv\r\n');
    ws.line(':justinfan12345!justinfan12345@justinfan12345.tmi.twitch.tv JOIN #mychannel');
    ws.line(':tmi.twitch.tv ROOMSTATE #mychannel');
    expect(h.events.filter((event) => event === 'joined')).toHaveLength(1);
    h.reader.dispose();
  });

  it('maps an ACTION message to the action kind', () => {
    const h = readerHarness();
    const messages: string[] = [];
    h.reader.join(
      'mychannel',
      handlers(h.events, {
        message: (message) => messages.push(`${message.kind}|${JSON.stringify(message.segments)}`),
      }),
    );
    const ws = h.sockets[0]!;
    ws.open();
    ws.line('@id=abc;display-name=Viewer :viewer!viewer@viewer.tmi.twitch.tv PRIVMSG #mychannel :\u0001ACTION waves\u0001');
    expect(messages).toEqual(['action|[{"t":"text","text":"waves"}]']);
    h.reader.dispose();
  });

  it('maps CLEARCHAT, CLEARMSG and USERNOTICE', () => {
    const h = readerHarness();
    h.reader.join('mychannel', handlers(h.events));
    const ws = h.sockets[0]!;
    ws.open();
    ws.line('@room-id=1;target-user-id=7 :tmi.twitch.tv CLEARCHAT #mychannel :viewer');
    ws.line('@room-id=1 :tmi.twitch.tv CLEARCHAT #mychannel');
    ws.line('@login=viewer;target-msg-id=msg-1 :tmi.twitch.tv CLEARMSG #mychannel :bad words');
    ws.line('@display-name=Viewer;login=viewer;msg-id=resub;system-msg=Viewer\\ssubscribed\\sat\\sTier\\s1. :tmi.twitch.tv USERNOTICE #mychannel');
    expect(h.events).toEqual([
      'clear-user:viewer',
      'clear-all',
      'delete:msg-1',
      'notice:Viewer subscribed at Tier 1.',
    ]);
    h.reader.dispose();
  });

  it('reports a suspended channel as an error', () => {
    const h = readerHarness();
    h.reader.join('mychannel', handlers(h.events));
    const ws = h.sockets[0]!;
    ws.open();
    ws.line('@msg-id=msg_channel_suspended :tmi.twitch.tv NOTICE #mychannel :This channel is unavailable.');
    expect(h.events).toEqual(["error:Twitch channel 'mychannel' is suspended"]);
    h.reader.dispose();
  });

  it('reconnects and rejoins when Twitch sends RECONNECT', () => {
    const h = readerHarness();
    h.reader.join('mychannel', handlers(h.events));
    h.sockets[0]!.open();
    h.sockets[0]!.line('RECONNECT');
    expect(h.sockets).toHaveLength(2);
    expect(h.sockets[0]!.closed).toBe(true);
    h.sockets[1]!.open();
    expect(h.sockets[1]!.sent).toContain('JOIN #mychannel\r\n');
    h.reader.dispose();
  });

  it('backs off on close and rejoins every channel', async () => {
    const h = readerHarness();
    h.reader.join('mychannel', handlers(h.events));
    h.sockets[0]!.open();
    h.sockets[0]!.drop();
    await h.timers.advance(1000);
    expect(h.sockets).toHaveLength(2);
    h.sockets[1]!.drop();
    await h.timers.advance(1000);
    expect(h.sockets).toHaveLength(2);
    await h.timers.advance(1000);
    expect(h.sockets).toHaveLength(3);
    h.sockets[2]!.open();
    expect(h.sockets[2]!.sent).toContain('JOIN #mychannel\r\n');
    h.reader.dispose();
  });

  it('closes the socket when the last channel leaves', () => {
    const h = readerHarness();
    h.reader.join('mychannel', handlers(h.events));
    h.sockets[0]!.open();
    h.reader.leave('mychannel');
    expect(h.sockets[0]!.sent.at(-1)).toBe('PART #mychannel\r\n');
    expect(h.sockets[0]!.closed).toBe(true);
  });
});

interface AdapterHarness {
  adapter: TwitchChatAdapter;
  timers: FakeTimers;
  sockets: FakeWs[];
  calls: FetchCall[];
  secrets: SecretStore;
  ops: ChatOp[];
  states: { key: string; state: string; detail?: string }[];
  sink: ChatSink;
}

function adapterHarness(router: FetchRouter, secrets: SecretStore): AdapterHarness {
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

const CHANNEL_REQ = {
  kind: 'chat',
  provider: 'twitch',
  key: 'twitch:mychannel',
  params: { channel: 'mychannel' },
} as const;

const ME_REQ = {
  kind: 'chat',
  provider: 'twitch',
  key: 'twitch:@me',
  params: { channel: '' },
} as const;

function helixRouter(): FetchRouter {
  return (call) => {
    if (call.url === 'https://id.twitch.tv/oauth2/validate') {
      return { status: 200, body: { login: 'streamer', user_id: '99' } };
    }
    if (call.url.includes('/helix/users?login=mychannel')) return { status: 200, body: { data: [{ id: '42' }] } };
    if (call.url.includes('/helix/chat/badges/global')) return { status: 200, body: { data: [] } };
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

describe('Twitch adapter anonymous mode', () => {
  it('reports connected anonymous status without any setup', async () => {
    const h = adapterHarness(helixRouter(), memorySecrets());
    await flush();
    const status = h.adapter.status();
    expect(status.state).toBe('connected');
    expect(status.mode).toBe('anonymous');
    expect(status.account).toBeUndefined();
    expect(status.message).toBe(
      'Reading chat anonymously — just enter a channel name. Sign-in is optional.',
    );
    h.adapter.dispose();
  });

  it('routes a channel to the anonymous IRC socket and goes live on join', async () => {
    const h = adapterHarness(helixRouter(), memorySecrets());
    await flush();
    h.adapter.start(CHANNEL_REQ, h.sink);
    await flush();
    expect(h.sockets).toHaveLength(1);
    expect(h.sockets[0]!.url).toBe(IRC_URL);
    expect(h.states.at(-1)).toEqual({ key: 'twitch:mychannel', state: 'connecting', detail: 'Connecting to Twitch chat' });
    h.sockets[0]!.open();
    h.sockets[0]!.line(':tmi.twitch.tv ROOMSTATE #mychannel');
    expect(h.states.at(-1)).toEqual({ key: 'twitch:mychannel', state: 'live' });
    h.adapter.dispose();
  });

  it('never sends a token on the anonymous socket', async () => {
    const secrets = memorySecrets({
      'twitch.clientId': 'abcdef1234567890',
      'twitch.tokens': {
        accessToken: 'stale-token',
        refreshToken: 'refresh-old',
        expiresAt: 1,
        userId: '99',
        login: 'streamer',
      },
    });
    const h = adapterHarness((call) => {
      if (call.url === 'https://id.twitch.tv/oauth2/token') {
        return { status: 400, body: { message: 'Invalid refresh token' } };
      }
      return undefined;
    }, secrets);
    await flush();
    expect(h.adapter.status().mode).toBe('anonymous');
    h.adapter.start(CHANNEL_REQ, h.sink);
    await flush();
    h.sockets[0]!.open();
    const sent = h.sockets[0]!.sent.join('');
    expect(sent).not.toMatch(/oauth|bearer|stale-token|refresh-old/i);
    expect(sent).toContain('PASS SCHMOOPIIE');
    h.adapter.dispose();
  });

  it('maps IRC messages, deletes and clears to chat ops', async () => {
    const h = adapterHarness(helixRouter(), memorySecrets());
    await flush();
    h.adapter.start(CHANNEL_REQ, h.sink);
    await flush();
    const ws = h.sockets[0]!;
    ws.open();
    ws.line(
      '@badges=subscriber/12;color=#FF00AA;display-name=Viewer;emotes=25:6-10;id=msg-1;tmi-sent-ts=1700000000000 :viewer!viewer@viewer.tmi.twitch.tv PRIVMSG #mychannel :hello Kappa',
    );
    ws.line('@target-msg-id=msg-1 :tmi.twitch.tv CLEARMSG #mychannel :hello Kappa');
    ws.line('@target-user-id=7 :tmi.twitch.tv CLEARCHAT #mychannel :viewer');
    ws.line(':tmi.twitch.tv CLEARCHAT #mychannel');
    const add = h.ops.find((op) => op.t === 'add');
    expect(add).toBeDefined();
    if (add?.t !== 'add') return;
    expect(add.message.id).toBe('tw:msg-1');
    expect(add.message.ts).toBe(1_700_000_000_000);
    expect(add.message.author.name).toBe('Viewer');
    expect(add.message.author.color).toBe('#FF00AA');
    expect(add.message.author.badges).toEqual([{ id: 'subscriber', label: 'subscriber 12' }]);
    expect(add.message.segments).toEqual([
      { t: 'text', text: 'hello ' },
      {
        t: 'emote',
        id: '25',
        name: 'Kappa',
        url: 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/1.0',
      },
    ]);
    expect(h.ops.slice(1)).toEqual([
      { t: 'delete', sourceKey: 'twitch:mychannel', messageId: 'tw:msg-1' },
      { t: 'clearUser', sourceKey: 'twitch:mychannel', authorId: 'viewer' },
      { t: 'clear', sourceKey: 'twitch:mychannel' },
    ]);
    h.adapter.dispose();
  });

  it('keeps @me offline with a clear detail when not signed in', async () => {
    const h = adapterHarness(helixRouter(), memorySecrets());
    await flush();
    h.adapter.start(ME_REQ, h.sink);
    await flush();
    expect(h.sockets).toHaveLength(0);
    expect(h.states.at(-1)).toEqual({
      key: 'twitch:@me',
      state: 'offline',
      detail: 'Enter a channel name (or sign in to use your own channel)',
    });
    h.adapter.dispose();
  });

  it('leaves the IRC socket when the source stops', async () => {
    const h = adapterHarness(helixRouter(), memorySecrets());
    await flush();
    h.adapter.start(CHANNEL_REQ, h.sink);
    await flush();
    h.sockets[0]!.open();
    h.adapter.stop('twitch:mychannel');
    expect(h.sockets[0]!.sent.at(-1)).toBe('PART #mychannel\r\n');
    expect(h.sockets[0]!.closed).toBe(true);
    h.adapter.dispose();
  });
});

describe('Twitch adapter signed-in routing', () => {
  it('uses EventSub when signed in and returns to IRC after sign out', async () => {
    const h = adapterHarness(helixRouter(), connectedSecrets());
    await flush();
    expect(h.adapter.status().mode).toBe('signed-in');
    h.adapter.start(CHANNEL_REQ, h.sink);
    await flush();
    expect(h.sockets).toHaveLength(1);
    expect(h.sockets[0]!.url).toBe('wss://eventsub.wss.twitch.tv/ws');
    h.sockets[0]!.emit({
      metadata: { message_type: 'session_welcome' },
      payload: { session: { id: 'sess-1', keepalive_timeout_seconds: 10 } },
    });
    await flush();
    expect(h.states.at(-1)).toEqual({ key: 'twitch:mychannel', state: 'live' });

    await h.adapter.signOut();
    await flush();
    const status = h.adapter.status();
    expect(status.state).toBe('connected');
    expect(status.mode).toBe('anonymous');
    expect(h.sockets).toHaveLength(2);
    expect(h.sockets[1]!.url).toBe(IRC_URL);
    h.adapter.dispose();
  });
});
