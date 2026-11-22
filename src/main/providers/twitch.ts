import type {
  ChatBadge,
  ChatMessage,
  ChatOp,
  ChatSegment,
  ProviderState,
  ProviderStatus,
  SourceState,
} from '../../shared/chat';
import { sanitizeChatMessage } from '../../shared/chat';
import type { TwitchAuthPrompt } from '../../shared/ipc';
import type { DataSourceRequest } from '../../widgets/contract';
import type { ChatAdapter, ChatSink } from './manager';
import {
  defaultWsFactory,
  systemTimers,
  type AdapterDeps,
  type FetchLike,
  type ProviderTimers,
  type WsFactory,
  type WsLike,
} from './deps';
import { TwitchIrcReader, normalizeChannel, type IrcChatMessage } from './twitchIrc';

export interface ProviderAdapterDeps extends AdapterDeps {
  onAuthPrompt?: (prompt: TwitchAuthPrompt) => void;
  ws?: WsFactory;
}

const DEVICE_URL = 'https://id.twitch.tv/oauth2/device';
const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const VALIDATE_URL = 'https://id.twitch.tv/oauth2/validate';
const REVOKE_URL = 'https://id.twitch.tv/oauth2/revoke';
const HELIX = 'https://api.twitch.tv/helix';
const EVENTS_WS = 'wss://eventsub.wss.twitch.tv/ws';
const SCOPES = 'user:read:chat';
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const VALIDATE_INTERVAL_MS = 60 * 60 * 1000;
const WELCOME_TIMEOUT_MS = 10_000;
const EMOTE_BASE = 'https://static-cdn.jtvnw.net/emoticons/v2';
const ANONYMOUS_MESSAGE = 'Reading chat anonymously — just enter a channel name. Sign-in is optional.';
const ME_WITHOUT_SIGN_IN = 'Enter a channel name (or sign in to use your own channel)';

const SUBSCRIPTION_TYPES = [
  'channel.chat.message',
  'channel.chat.message_delete',
  'channel.chat.clear',
  'channel.chat.clear_user_messages',
] as const;

interface TwitchTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  userId: string;
  login: string;
}

interface SourceEntry {
  req: DataSourceRequest;
  sink: ChatSink;
  broadcasterId: string | null;
  ircChannel: string | null;
  state: SourceState;
  detail?: string;
}

interface AuthSession {
  deviceCode: string;
  interval: number;
  cancelled: boolean;
  timer: unknown;
}

interface HelixUser {
  id?: string;
  login?: string;
}

interface HelixBadgeVersion {
  id?: string;
  image_url_1x?: string;
  title?: string;
}

interface HelixBadgeSet {
  set_id?: string;
  versions?: HelixBadgeVersion[];
}

interface HelixSubscription {
  id?: string;
}

interface HelixInit {
  method?: string;
  body?: string;
}

interface ChatFragment {
  type?: string;
  text?: string;
  emote?: { id?: string };
}

interface ChatEvent {
  message_id?: string;
  chatter_user_id?: string;
  chatter_user_login?: string;
  chatter_user_name?: string;
  broadcaster_user_id?: string;
  color?: string;
  message_type?: string;
  badges?: { set_id?: string; id?: string }[];
  message?: { text?: string; fragments?: ChatFragment[] };
  target_user_id?: string;
}

interface EventSubPayload {
  subscription?: { type?: string; id?: string };
  event?: ChatEvent;
  session?: { id?: string; keepalive_timeout_seconds?: number; reconnect_url?: string };
}

interface EventSubMessage {
  metadata?: { message_type?: string };
  payload?: EventSubPayload;
}

function formBody(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

export class TwitchChatAdapter implements ChatAdapter {
  private readonly sources = new Map<string, SourceEntry>();
  private readonly subscriptions = new Map<string, { broadcasterId: string; type: string }>();
  private readonly subscribing = new Map<string, Promise<void>>();
  private readonly badges = new Map<string, Map<string, Map<string, { url: string; title: string }>>>();
  private readonly timers: ProviderTimers;
  private readonly wsFactory: WsFactory;
  private readonly irc: TwitchIrcReader;
  private tokens: TwitchTokens | null;
  private state: ProviderState = 'connected';
  private message: string | undefined = ANONYMOUS_MESSAGE;
  private account: string | undefined;
  private auth: AuthSession | null = null;
  private ws: WsLike | null = null;
  private sessionId: string | null = null;
  private keepaliveMs = 0;
  private watchdog: unknown = null;
  private reconnectTimer: unknown = null;
  private backoff = 0;
  private pendingReconnect: { ws: WsLike } | null = null;
  private validateTimer: unknown = null;
  private refreshing: Promise<boolean> | null = null;
  private welcomeWaiters: (() => void)[] = [];

  constructor(readonly deps: ProviderAdapterDeps) {
    this.timers = deps.timers ?? systemTimers;
    this.wsFactory = deps.ws ?? defaultWsFactory;
    this.irc = new TwitchIrcReader({ ws: this.wsFactory, timers: this.timers, log: deps.log });
    this.tokens = deps.secrets.get<TwitchTokens>('twitch.tokens');
    void this.restore();
  }

  private get fetchImpl(): FetchLike {
    return this.deps.fetch ?? fetch;
  }

  private clientId(): string {
    return this.deps.secrets.get<string>('twitch.clientId') ?? '';
  }

  private signedIn(): boolean {
    return this.state === 'connected' && !!this.tokens && !!this.clientId();
  }

  private mode(): 'anonymous' | 'signed-in' {
    return this.tokens && this.clientId() ? 'signed-in' : 'anonymous';
  }

  async configure(clientId: string): Promise<void> {
    const previous = this.clientId();
    if (previous === clientId) return;
    if (this.tokens) await this.signOut();
    this.deps.secrets.set('twitch.clientId', clientId);
    this.setState('connected', ANONYMOUS_MESSAGE);
    this.resolveAll();
  }

  async startAuth(): Promise<TwitchAuthPrompt> {
    const clientId = this.clientId();
    if (!clientId) throw new Error('Save your Twitch Client ID first.');
    this.cancelAuth();
    const res = await this.fetchImpl(DEVICE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody({ client_id: clientId, scopes: SCOPES }),
    });
    if (!res.ok) {
      this.deps.log.warn(`Twitch device flow rejected (HTTP ${res.status})`);
      this.setState('error', 'Twitch did not start sign-in. Check your Client ID and try again.');
      throw new Error('Twitch did not start sign-in. Check your Client ID and try again.');
    }
    const data = (await res.json()) as {
      device_code?: string;
      user_code?: string;
      verification_uri?: string;
      expires_in?: number;
      interval?: number;
    };
    if (!data.device_code || !data.user_code || !data.verification_uri) {
      this.setState('error', 'Twitch did not start sign-in. Check your Client ID and try again.');
      throw new Error('Twitch did not start sign-in. Check your Client ID and try again.');
    }
    const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 1800;
    const interval = typeof data.interval === 'number' && data.interval > 0 ? data.interval : 5;
    const prompt: TwitchAuthPrompt = {
      userCode: data.user_code,
      verificationUri: data.verification_uri,
      expiresAt: this.timers.now() + expiresIn * 1000,
    };
    this.auth = { deviceCode: data.device_code, interval, cancelled: false, timer: null };
    this.setState('authorizing', 'Waiting for you to approve NeonStage on Twitch.');
    this.deps.onAuthPrompt?.(prompt);
    this.schedulePoll(interval * 1000);
    return prompt;
  }

  cancelAuth(): void {
    const auth = this.auth;
    if (!auth) return;
    auth.cancelled = true;
    this.timers.clearTimeout(auth.timer);
    this.auth = null;
    if (this.state !== 'authorizing') return;
    this.setState('connected', this.tokens ? undefined : ANONYMOUS_MESSAGE);
    this.resolveAll();
  }

  async signOut(): Promise<void> {
    const tokens = this.tokens;
    const clientId = this.clientId();
    this.cancelAuth();
    this.clearTokens();
    this.dropSocket();
    this.subscriptions.clear();
    this.badges.clear();
    this.account = undefined;
    this.setState('connected', ANONYMOUS_MESSAGE);
    this.resolveAll();
    if (!tokens || !clientId) return;
    try {
      await this.fetchImpl(REVOKE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formBody({ client_id: clientId, token: tokens.accessToken }),
      });
    } catch {
      this.deps.log.warn('Twitch token revoke failed');
    }
  }

  async reconnect(): Promise<void> {
    if (!this.signedIn()) {
      this.setState('connected', ANONYMOUS_MESSAGE);
      this.irc.reconnect();
      this.resolveAll();
      return;
    }
    this.dropSocket();
    this.backoff = 0;
    this.setState('reconnecting', 'Reconnecting to Twitch chat...');
    this.connect();
    await this.waitForWelcome();
    this.resolveAll();
  }

  start(req: DataSourceRequest, sink: ChatSink): void {
    this.sources.set(req.key, { req, sink, broadcasterId: null, ircChannel: null, state: 'offline' });
    void this.resolveSource(req.key);
  }

  stop(key: string): void {
    const entry = this.sources.get(key);
    if (!entry) return;
    this.sources.delete(key);
    if (entry.ircChannel) this.irc.leave(entry.ircChannel);
    const broadcasterId = entry.broadcasterId;
    if (!broadcasterId) return;
    const stillUsed = [...this.sources.values()].some((other) => other.broadcasterId === broadcasterId);
    if (stillUsed) return;
    this.badges.delete(broadcasterId);
    void this.unsubscribeBroadcaster(broadcasterId);
  }

  status(): ProviderStatus {
    return {
      provider: 'twitch',
      state: this.state,
      mode: this.mode(),
      ...(this.account && this.state === 'connected' ? { account: this.account } : {}),
      ...(this.message ? { message: this.message } : {}),
      sources: [...this.sources.entries()].map(([key, entry]) => ({
        key,
        state: entry.state,
        ...(entry.detail ? { detail: entry.detail } : {}),
      })),
    };
  }

  dispose(): void {
    this.cancelAuth();
    this.timers.clearInterval(this.validateTimer);
    this.validateTimer = null;
    this.dropSocket();
    this.timers.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.subscriptions.clear();
    this.irc.dispose();
    this.sources.clear();
  }

  private setState(state: ProviderState, message?: string): void {
    if (this.state === state && this.message === message) return;
    this.state = state;
    this.message = message;
    this.deps.onStatusChange?.();
  }

  private setSource(key: string, state: SourceState, detail?: string): void {
    const entry = this.sources.get(key);
    if (!entry) return;
    entry.state = state;
    entry.detail = detail;
    entry.sink.sourceState(key, state, detail);
  }

  private markSources(state: SourceState, detail?: string): void {
    for (const key of [...this.sources.keys()]) this.setSource(key, state, detail);
  }

  private persistTokens(): void {
    if (this.tokens) this.deps.secrets.set('twitch.tokens', this.tokens);
  }

  private clearTokens(): void {
    this.tokens = null;
    this.deps.secrets.delete('twitch.tokens');
  }

  private async restore(): Promise<void> {
    if (!this.clientId() || !this.tokens) {
      this.setState('connected', ANONYMOUS_MESSAGE);
      this.resolveAll();
      return;
    }
    this.setState('connecting', 'Checking Twitch sign-in...');
    await this.validate(0);
  }

  private async validate(depth: number): Promise<boolean> {
    if (!this.tokens) return false;
    if (!(await this.ensureToken())) return false;
    const res = await this.fetchImpl(VALIDATE_URL, {
      headers: { Authorization: `OAuth ${this.tokens.accessToken}` },
    });
    if (res.status === 401) {
      if (depth > 0) return false;
      if (!(await this.refresh())) return false;
      return this.validate(depth + 1);
    }
    if (!res.ok) {
      this.deps.log.warn(`Twitch validate failed (HTTP ${res.status})`);
      this.setState('error', `Twitch sign-in check failed (HTTP ${res.status}).`);
      return false;
    }
    const data = (await res.json()) as { user_id?: string; login?: string };
    this.tokens = {
      ...this.tokens,
      userId: data.user_id ?? this.tokens.userId,
      login: data.login ?? this.tokens.login,
    };
    this.persistTokens();
    this.account = this.tokens.login || undefined;
    this.setState('connected');
    this.startValidateTimer();
    this.resolveAll();
    return true;
  }

  private startValidateTimer(): void {
    if (this.validateTimer !== null) return;
    this.validateTimer = this.timers.setInterval(() => {
      void this.validate(0);
    }, VALIDATE_INTERVAL_MS);
  }

  private async ensureToken(): Promise<boolean> {
    if (!this.tokens) return false;
    if (this.tokens.expiresAt - this.timers.now() > 60_000) return true;
    return this.refresh();
  }

  private async refresh(): Promise<boolean> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.doRefresh();
    try {
      return await this.refreshing;
    } finally {
      this.refreshing = null;
    }
  }

  private async doRefresh(): Promise<boolean> {
    const tokens = this.tokens;
    const clientId = this.clientId();
    if (!tokens || !clientId) return false;
    const res = await this.fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody({
        grant_type: 'refresh_token',
        refresh_token: tokens.refreshToken,
        client_id: clientId,
      }),
    });
    if (!res.ok) {
      this.deps.log.warn(`Twitch token refresh failed (HTTP ${res.status})`);
      this.clearTokens();
      this.dropSocket();
      this.account = undefined;
      this.setState('connected', ANONYMOUS_MESSAGE);
      this.resolveAll();
      return false;
    }
    const data = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!data.access_token) return false;
    this.tokens = {
      ...tokens,
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? tokens.refreshToken,
      expiresAt: this.timers.now() + (data.expires_in ?? 3600) * 1000,
    };
    this.persistTokens();
    return true;
  }

  private schedulePoll(ms: number): void {
    const auth = this.auth;
    if (!auth) return;
    auth.timer = this.timers.setTimeout(() => {
      void this.pollDevice();
    }, ms);
  }

  private async pollDevice(): Promise<void> {
    const auth = this.auth;
    const clientId = this.clientId();
    if (!auth || auth.cancelled || !clientId) return;
    const res = await this.fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody({
        client_id: clientId,
        scopes: SCOPES,
        device_code: auth.deviceCode,
        grant_type: DEVICE_GRANT,
      }),
    });
    if (res.ok) {
      const data = (await res.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
      };
      if (!data.access_token || !data.refresh_token) {
        this.auth = null;
        this.setState('error', 'Twitch sign-in failed — try Connect again.');
        return;
      }
      this.auth = null;
      this.tokens = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: this.timers.now() + (data.expires_in ?? 3600) * 1000,
        userId: '',
        login: '',
      };
      this.persistTokens();
      this.setState('connecting', 'Finishing Twitch sign-in…');
      await this.validate(0);
      return;
    }
    let reason = '';
    try {
      const body = (await res.json()) as { message?: string };
      reason = typeof body.message === 'string' ? body.message : '';
    } catch {
      reason = '';
    }
    if (reason === 'authorization_pending') {
      this.schedulePoll(auth.interval * 1000);
      return;
    }
    if (reason === 'slow_down') {
      auth.interval += 5;
      this.schedulePoll(auth.interval * 1000);
      return;
    }
    this.deps.log.warn(`Twitch device flow stopped (HTTP ${res.status})`);
    this.auth = null;
    this.setState('error', 'Twitch sign-in failed or expired — try Connect again.');
  }

  private resolveAll(): void {
    for (const key of [...this.sources.keys()]) void this.resolveSource(key);
  }

  private async resolveSource(key: string): Promise<void> {
    const entry = this.sources.get(key);
    if (!entry) return;
    const login = key.startsWith('twitch:') ? key.slice('twitch:'.length) : '';
    if (!login) {
      this.setSource(key, 'offline', 'Twitch channel not specified');
      return;
    }
    if (!this.signedIn()) {
      this.resolveAnonymous(key, login);
      return;
    }
    await this.resolveEventSub(key, login);
  }

  private resolveAnonymous(key: string, login: string): void {
    const entry = this.sources.get(key);
    if (!entry) return;
    if (login === '@me') {
      this.setSource(key, 'offline', ME_WITHOUT_SIGN_IN);
      return;
    }
    const channel = normalizeChannel(login);
    if (!channel) {
      this.setSource(key, 'offline', 'Twitch channel not specified');
      return;
    }
    entry.broadcasterId = null;
    entry.ircChannel = channel;
    this.setSource(key, 'connecting', 'Connecting to Twitch chat');
    this.irc.join(channel, {
      message: (message) => this.emitIrcMessage(key, message),
      notice: (message) => this.emitIrcMessage(key, message),
      clearUser: (authorId) => this.emitIrcOp(key, { t: 'clearUser', sourceKey: key, authorId }),
      clearAll: () => this.emitIrcOp(key, { t: 'clear', sourceKey: key }),
      deleteMessage: (messageId) =>
        this.emitIrcOp(key, { t: 'delete', sourceKey: key, messageId: `tw:${messageId}` }),
      joined: () => this.setSource(key, 'live'),
      error: (detail) => this.setSource(key, 'offline', detail),
    });
  }

  private emitIrcOp(key: string, op: ChatOp): void {
    this.sources.get(key)?.sink.ops([op]);
  }

  private emitIrcMessage(key: string, data: IrcChatMessage): void {
    const entry = this.sources.get(key);
    if (!entry) return;
    const message: ChatMessage = {
      id: `tw:${data.id}`,
      sourceKey: key,
      platform: 'twitch',
      ts: data.ts,
      author: data.author,
      segments: data.segments,
      kind: data.kind,
      meta: data.meta,
    };
    entry.sink.ops([{ t: 'add', sourceKey: key, message: sanitizeChatMessage(message) }]);
  }

  private async resolveEventSub(key: string, login: string): Promise<void> {
    const entry = this.sources.get(key);
    if (!entry) return;
    if (entry.ircChannel) {
      this.irc.leave(entry.ircChannel);
      entry.ircChannel = null;
    }
    let broadcasterId: string | null = null;
    if (login === '@me') {
      broadcasterId = this.tokens?.userId || null;
      if (!broadcasterId) {
        this.setSource(key, 'offline', 'Twitch sign-in is missing an account id');
        return;
      }
    } else {
      const res = await this.helix<{ data?: HelixUser[] }>(
        `/users?login=${encodeURIComponent(login)}`,
      );
      broadcasterId = res?.data?.[0]?.id ?? null;
      if (!broadcasterId) {
        this.setSource(key, 'offline', `Twitch channel '${login}' not found`);
        return;
      }
    }
    const current = this.sources.get(key);
    if (!current) return;
    current.broadcasterId = broadcasterId;
    this.setSource(key, 'connecting', 'Connecting to Twitch chat');
    await this.ensureSession();
    if (!this.sources.has(key)) return;
    await this.subscribeBroadcaster(broadcasterId);
    if (!this.sources.has(key)) return;
    this.setSource(key, 'live');
  }

  private async ensureSession(): Promise<void> {
    if (this.sessionId) return;
    if (!this.ws) this.connect();
    await this.waitForWelcome();
  }

  private waitForWelcome(): Promise<void> {
    if (this.sessionId) return Promise.resolve();
    return new Promise((resolve) => {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        this.timers.clearTimeout(handle);
        resolve();
      };
      const handle = this.timers.setTimeout(finish, WELCOME_TIMEOUT_MS);
      this.welcomeWaiters.push(finish);
    });
  }

  private releaseWaiters(): void {
    const waiters = this.welcomeWaiters;
    this.welcomeWaiters = [];
    for (const waiter of waiters) waiter();
  }

  private connect(): void {
    if (this.ws) return;
    this.ws = this.openSocket(EVENTS_WS);
    this.setState(this.state === 'connected' ? 'reconnecting' : 'connecting', 'Connecting to Twitch chat…');
  }

  private openSocket(url: string): WsLike {
    const ws = this.wsFactory(url);
    ws.onopen = null;
    ws.onerror = null;
    ws.onmessage = (event) => {
      this.onMessage(ws, event.data);
    };
    ws.onclose = () => {
      this.onSocketClosed(ws);
    };
    return ws;
  }

  private onSocketClosed(ws: WsLike): void {
    if (this.pendingReconnect && this.pendingReconnect.ws === ws) {
      this.pendingReconnect = null;
      return;
    }
    if (this.ws !== ws) return;
    this.ws = null;
    this.sessionId = null;
    this.clearWatchdog();
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    const delay = Math.min(60, 2 ** this.backoff) * 1000 + Math.floor(Math.random() * 250);
    this.backoff = Math.min(this.backoff + 1, 6);
    this.setState('reconnecting', 'Reconnecting to Twitch chat…');
    this.markSources('connecting', 'Reconnecting to Twitch chat');
    this.reconnectTimer = this.timers.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private dropSocket(): void {
    const ws = this.ws;
    this.ws = null;
    this.sessionId = null;
    this.clearWatchdog();
    this.releaseWaiters();
    if (!ws) return;
    ws.onmessage = null;
    ws.onclose = null;
    ws.onerror = null;
    ws.close();
  }

  private clearWatchdog(): void {
    if (this.watchdog === null) return;
    this.timers.clearTimeout(this.watchdog);
    this.watchdog = null;
  }

  private resetWatchdog(): void {
    this.clearWatchdog();
    if (this.keepaliveMs <= 0) return;
    this.watchdog = this.timers.setTimeout(() => {
      this.watchdog = null;
      this.deps.log.warn('Twitch EventSub keepalive timed out');
      this.dropSocket();
      this.scheduleReconnect();
    }, this.keepaliveMs * 1000 + 5000);
  }

  private onMessage(ws: WsLike, raw: unknown): void {
    if (typeof raw !== 'string') return;
    let parsed: EventSubMessage;
    try {
      parsed = JSON.parse(raw) as EventSubMessage;
    } catch {
      return;
    }
    this.resetWatchdog();
    const type = parsed.metadata?.message_type;
    if (type === 'session_welcome') {
      this.onWelcome(ws, parsed.payload?.session);
      return;
    }
    if (type === 'session_reconnect') {
      this.onReconnectRequest(parsed.payload?.session?.reconnect_url);
      return;
    }
    if (type === 'revocation') {
      this.onRevocation(parsed.payload?.subscription);
      return;
    }
    if (type === 'notification') {
      this.onNotification(parsed.payload);
    }
  }

  private onWelcome(ws: WsLike, session: EventSubPayload['session']): void {
    const sessionId = session?.id;
    if (!sessionId) return;
    this.keepaliveMs = session?.keepalive_timeout_seconds ?? 0;
    this.backoff = 0;
    this.timers.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const pending = this.pendingReconnect;
    if (pending && pending.ws === ws) {
      const previous = this.ws;
      this.ws = ws;
      this.sessionId = sessionId;
      this.pendingReconnect = null;
      if (previous && previous !== ws) {
        previous.onmessage = null;
        previous.onclose = null;
        previous.onerror = null;
        previous.close();
      }
      this.resetWatchdog();
      this.releaseWaiters();
      this.setState('connected');
      this.markSources('live');
      return;
    }
    if (this.ws !== ws) return;
    this.sessionId = sessionId;
    this.resetWatchdog();
    this.releaseWaiters();
    this.setState('connected');
    this.subscribeAll();
  }

  private onReconnectRequest(url: string | undefined): void {
    if (!url || this.pendingReconnect) return;
    const ws = this.openSocket(url);
    this.pendingReconnect = { ws };
  }

  private onRevocation(subscription: EventSubPayload['subscription']): void {
    const id = subscription?.id;
    const entry = id ? this.subscriptions.get(id) : undefined;
    if (id) this.subscriptions.delete(id);
    const broadcasterId = entry?.broadcasterId;
    if (!broadcasterId) return;
    for (const [key, source] of this.sources) {
      if (source.broadcasterId !== broadcasterId) continue;
      this.setSource(key, 'offline', 'Twitch revoked the chat subscription');
    }
  }

  private subscribeAll(): void {
    const ids = new Set<string>();
    for (const source of this.sources.values()) {
      if (source.broadcasterId) ids.add(source.broadcasterId);
    }
    for (const id of ids) void this.subscribeBroadcaster(id);
  }

  private async subscribeBroadcaster(broadcasterId: string): Promise<void> {
    if (!this.sessionId) return;
    const existing = [...this.subscriptions.values()].some(
      (entry) => entry.broadcasterId === broadcasterId,
    );
    if (existing) return;
    const inFlight = this.subscribing.get(broadcasterId);
    if (inFlight) return inFlight;
    const task = this.createSubscriptions(broadcasterId);
    this.subscribing.set(broadcasterId, task);
    try {
      await task;
    } finally {
      this.subscribing.delete(broadcasterId);
    }
  }

  private async createSubscriptions(broadcasterId: string): Promise<void> {
    await this.ensureBadges(broadcasterId);
    const userId = this.tokens?.userId ?? '';
    for (const type of SUBSCRIPTION_TYPES) {
      const res = await this.helix<{ data?: HelixSubscription[] }>('/eventsub/subscriptions', {
        method: 'POST',
        body: JSON.stringify({
          type,
          version: '1',
          condition: { broadcaster_user_id: broadcasterId, user_id: userId },
          transport: { method: 'websocket', session_id: this.sessionId },
        }),
      });
      const id = res?.data?.[0]?.id;
      if (id) this.subscriptions.set(id, { broadcasterId, type });
    }
  }

  private async unsubscribeBroadcaster(broadcasterId: string): Promise<void> {
    const ids = [...this.subscriptions.entries()]
      .filter(([, entry]) => entry.broadcasterId === broadcasterId)
      .map(([id]) => id);
    for (const id of ids) {
      this.subscriptions.delete(id);
      await this.helix(`/eventsub/subscriptions?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    }
  }

  private async ensureBadges(broadcasterId: string): Promise<void> {
    if (this.badges.has(broadcasterId)) return;
    const sets = new Map<string, Map<string, { url: string; title: string }>>();
    const global = await this.helix<{ data?: HelixBadgeSet[] }>('/chat/badges/global');
    this.collectBadges(sets, global?.data);
    const channel = await this.helix<{ data?: HelixBadgeSet[] }>(
      `/chat/badges?broadcaster_id=${encodeURIComponent(broadcasterId)}`,
    );
    this.collectBadges(sets, channel?.data);
    this.badges.set(broadcasterId, sets);
  }

  private collectBadges(
    target: Map<string, Map<string, { url: string; title: string }>>,
    sets: HelixBadgeSet[] | undefined,
  ): void {
    for (const set of sets ?? []) {
      if (!set?.set_id || !Array.isArray(set.versions)) continue;
      const versions = target.get(set.set_id) ?? new Map<string, { url: string; title: string }>();
      for (const version of set.versions) {
        if (!version?.id) continue;
        versions.set(String(version.id), {
          url: typeof version.image_url_1x === 'string' ? version.image_url_1x : '',
          title: typeof version.title === 'string' ? version.title : set.set_id,
        });
      }
      target.set(set.set_id, versions);
    }
  }

  private badgesFor(broadcasterId: string, badges: ChatEvent['badges']): ChatBadge[] {
    const cache = this.badges.get(broadcasterId);
    const out: ChatBadge[] = [];
    for (const badge of badges ?? []) {
      if (!badge?.set_id || !badge.id) continue;
      const version = cache?.get(badge.set_id)?.get(String(badge.id));
      const label = version?.title ?? badge.set_id;
      out.push(
        version?.url
          ? { id: badge.set_id, label, imageUrl: version.url }
          : { id: badge.set_id, label },
      );
    }
    return out;
  }

  private onNotification(payload: EventSubPayload | undefined): void {
    const type = payload?.subscription?.type;
    const event = payload?.event;
    if (!type || !event) return;
    const broadcasterId = event.broadcaster_user_id ?? '';
    const keys = [...this.sources.entries()]
      .filter(([, source]) => source.broadcasterId === broadcasterId)
      .map(([key]) => key);
    if (keys.length === 0) return;

    if (type === 'channel.chat.message') {
      for (const key of keys) this.emitMessage(key, broadcasterId, event);
      return;
    }
    if (type === 'channel.chat.message_delete') {
      const messageId = event.message_id;
      if (!messageId) return;
      for (const key of keys) {
        this.sources.get(key)?.sink.ops([{ t: 'delete', sourceKey: key, messageId: `tw:${messageId}` }]);
      }
      return;
    }
    if (type === 'channel.chat.clear') {
      for (const key of keys) this.sources.get(key)?.sink.ops([{ t: 'clear', sourceKey: key }]);
      return;
    }
    if (type === 'channel.chat.clear_user_messages') {
      const authorId = event.target_user_id;
      if (!authorId) return;
      for (const key of keys) {
        this.sources.get(key)?.sink.ops([{ t: 'clearUser', sourceKey: key, authorId }]);
      }
    }
  }

  private emitMessage(key: string, broadcasterId: string, event: ChatEvent): void {
    const entry = this.sources.get(key);
    if (!entry) return;
    const rawText = typeof event.message?.text === 'string' ? event.message.text : '';
    const isAction = event.message_type === 'action' || rawText.startsWith('\u0001ACTION ');
    const segments: ChatSegment[] = [];
    const fragments = event.message?.fragments ?? [];
    for (const fragment of fragments) {
      const text = typeof fragment.text === 'string' ? fragment.text : '';
      if (fragment.type === 'emote' && fragment.emote?.id) {
        segments.push({
          t: 'emote',
          id: String(fragment.emote.id),
          name: text,
          url: `${EMOTE_BASE}/${fragment.emote.id}/default/dark/1.0`,
        });
      } else if (fragment.type === 'mention') {
        segments.push({ t: 'mention', text });
      } else {
        segments.push({ t: 'text', text });
      }
    }
    if (segments.length === 0) segments.push({ t: 'text', text: rawText });
    if (isAction) {
      const first = segments[0];
      if (first && first.t === 'text') {
        first.text = first.text.replace(/^\u0001ACTION\s?/, '').replace(/\u0001$/, '');
      }
    }
    const color = typeof event.color === 'string' ? event.color : '';
    const message: ChatMessage = {
      id: `tw:${event.message_id ?? ''}`,
      sourceKey: key,
      platform: 'twitch',
      ts: this.timers.now(),
      author: {
        id: event.chatter_user_id ?? '',
        name: event.chatter_user_name ?? event.chatter_user_login ?? '',
        ...(color ? { color } : {}),
        badges: this.badgesFor(broadcasterId, event.badges),
      },
      segments,
      kind: isAction ? 'action' : 'message',
      meta: {
        messageType: event.message_type ?? 'text',
        login: event.chatter_user_login ?? '',
      },
    };
    entry.sink.ops([{ t: 'add', sourceKey: key, message: sanitizeChatMessage(message) }]);
  }

  private async helix<T>(path: string, init?: HelixInit): Promise<T | null> {
    if (!(await this.ensureToken())) return null;
    const send = (): Promise<Response> =>
      this.fetchImpl(`${HELIX}${path}`, {
        method: init?.method ?? 'GET',
        headers: {
          Authorization: `Bearer ${this.tokens?.accessToken ?? ''}`,
          'Client-Id': this.clientId(),
          ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(init?.body ? { body: init.body } : {}),
      });
    let res = await send();
    if (res.status === 401) {
      if (!(await this.refresh())) return null;
      res = await send();
    }
    if (!res.ok) {
      this.deps.log.warn(`Twitch Helix ${path.split('?')[0]} -> HTTP ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  }
}
