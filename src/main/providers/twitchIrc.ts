import type { ChatAuthor, ChatBadge, ChatMessageKind, ChatSegment } from '../../shared/chat';
import type { Logger } from '../log';
import {
  defaultWsFactory,
  systemTimers,
  type ProviderTimers,
  type WsFactory,
  type WsLike,
} from './deps';

export const IRC_URL = 'wss://irc-ws.chat.twitch.tv:443';

const EMOTE_BASE = 'https://static-cdn.jtvnw.net/emoticons/v2';
const WATCHDOG_MS = 6 * 60 * 1000;
const MAX_BACKOFF_MS = 30_000;
const MAX_BACKOFF_STEP = 5;
const JOIN_LIMIT = 20;
const JOIN_WINDOW_MS = 10_000;
const CHANNEL = /^[a-z0-9_]{1,25}$/;

const NOTICE_ERRORS: Record<string, string> = {
  msg_channel_suspended: 'is suspended',
  msg_banned: 'is not available',
  msg_room_not_found: 'was not found',
  msg_login_required: 'needs a channel name',
};

export interface IrcChatMessage {
  id: string;
  ts: number;
  author: ChatAuthor;
  segments: ChatSegment[];
  kind: ChatMessageKind;
  meta: Record<string, unknown>;
}

export interface TwitchIrcHandlers {
  message?(message: IrcChatMessage): void;
  notice?(message: IrcChatMessage): void;
  clearUser?(authorId: string): void;
  clearAll?(): void;
  deleteMessage?(messageId: string): void;
  joined?(): void;
  error?(detail: string): void;
}

export interface TwitchIrcOptions {
  ws?: WsFactory;
  timers?: ProviderTimers;
  log?: Logger;
}

export interface IrcLine {
  tags: Record<string, string>;
  prefix: string;
  command: string;
  params: string[];
}

export interface IrcEmoteRange {
  id: string;
  start: number;
  end: number;
}

export function normalizeChannel(value: string): string {
  let name = value.trim().toLowerCase();
  if (!name) return '';
  name = name.replace(/^#/, '');
  name = name.replace(/^https?:\/\/(?:www\.)?twitch\.tv\//, '');
  name = name.replace(/^twitch\.tv\//, '');
  name = name.split(/[/?#]/)[0] ?? '';
  return CHANNEL.test(name) ? name : '';
}

export function unescapeTag(value: string): string {
  let out = '';
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    if (char !== '\\') {
      out += char;
      continue;
    }
    const next = value[index + 1];
    index += 1;
    if (next === 's') out += ' ';
    else if (next === ':') out += ';';
    else if (next === '\\') out += '\\';
    else if (next === 'r') out += '\r';
    else if (next === 'n') out += '\n';
    else if (next !== undefined) out += next;
  }
  return out;
}

function parseTags(raw: string): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const part of raw.split(';')) {
    if (!part) continue;
    const index = part.indexOf('=');
    if (index < 0) {
      tags[part] = '';
      continue;
    }
    tags[part.slice(0, index)] = unescapeTag(part.slice(index + 1));
  }
  return tags;
}

export function parseIrcLine(raw: string): IrcLine | null {
  let rest = raw.trim();
  if (!rest) return null;
  let tags: Record<string, string> = {};
  if (rest.startsWith('@')) {
    const space = rest.indexOf(' ');
    if (space < 0) return null;
    tags = parseTags(rest.slice(1, space));
    rest = rest.slice(space + 1).trim();
  }
  let prefix = '';
  if (rest.startsWith(':')) {
    const space = rest.indexOf(' ');
    if (space < 0) return null;
    prefix = rest.slice(1, space);
    rest = rest.slice(space + 1).trim();
  }
  const params: string[] = [];
  const trailing = rest.indexOf(' :');
  let head = rest;
  if (trailing >= 0) {
    head = rest.slice(0, trailing);
    params.push(rest.slice(trailing + 2));
  }
  const parts = head.split(' ').filter(Boolean);
  const command = parts[0];
  if (!command) return null;
  params.unshift(...parts.slice(1));
  return { tags, prefix, command: command.toUpperCase(), params };
}

export function parseEmoteTag(raw: string): IrcEmoteRange[] {
  const ranges: IrcEmoteRange[] = [];
  for (const group of raw.split('/')) {
    if (!group) continue;
    const colon = group.indexOf(':');
    if (colon <= 0) continue;
    const id = group.slice(0, colon);
    for (const range of group.slice(colon + 1).split(',')) {
      const dash = range.indexOf('-');
      if (dash <= 0) continue;
      const start = Number(range.slice(0, dash));
      const end = Number(range.slice(dash + 1));
      if (!Number.isInteger(start) || !Number.isInteger(end)) continue;
      if (start < 0 || end < start) continue;
      ranges.push({ id, start, end });
    }
  }
  return ranges.sort((left, right) => left.start - right.start);
}

export function segmentText(text: string, emotes: IrcEmoteRange[]): ChatSegment[] {
  const chars = Array.from(text);
  const segments: ChatSegment[] = [];
  let cursor = 0;
  for (const emote of emotes) {
    if (emote.start < cursor || emote.end >= chars.length) continue;
    if (emote.start > cursor) {
      segments.push({ t: 'text', text: chars.slice(cursor, emote.start).join('') });
    }
    segments.push({
      t: 'emote',
      id: emote.id,
      name: chars.slice(emote.start, emote.end + 1).join(''),
      url: `${EMOTE_BASE}/${emote.id}/default/dark/1.0`,
    });
    cursor = emote.end + 1;
  }
  if (cursor < chars.length) segments.push({ t: 'text', text: chars.slice(cursor).join('') });
  if (segments.length === 0) segments.push({ t: 'text', text });
  return segments;
}

export function parseBadges(raw: string): ChatBadge[] {
  const badges: ChatBadge[] = [];
  for (const part of raw.split(',')) {
    if (!part) continue;
    const slash = part.indexOf('/');
    const id = slash < 0 ? part : part.slice(0, slash);
    const version = slash < 0 ? '' : part.slice(slash + 1);
    if (!id) continue;
    badges.push({ id, label: version && version !== '1' ? `${id} ${version}` : id });
  }
  return badges;
}

function loginFromPrefix(prefix: string): string {
  const bang = prefix.indexOf('!');
  return bang < 0 ? prefix : prefix.slice(0, bang);
}

function randomNick(): string {
  return `justinfan${Math.floor(Math.random() * 90_000) + 10_000}`;
}

export class TwitchIrcReader {
  private readonly channels = new Map<string, TwitchIrcHandlers>();
  private readonly joined = new Set<string>();
  private readonly wsFactory: WsFactory;
  private readonly timers: ProviderTimers;
  private readonly log: Logger | undefined;
  private readonly nick = randomNick();
  private ws: WsLike | null = null;
  private ready = false;
  private backoff = 0;
  private reconnectTimer: unknown = null;
  private watchdog: unknown = null;
  private joinQueue: string[] = [];
  private joinTimes: number[] = [];
  private joinTimer: unknown = null;

  constructor(options: TwitchIrcOptions = {}) {
    this.wsFactory = options.ws ?? defaultWsFactory;
    this.timers = options.timers ?? systemTimers;
    this.log = options.log;
  }

  join(channel: string, handlers: TwitchIrcHandlers): void {
    const name = normalizeChannel(channel);
    if (!name) return;
    this.channels.set(name, handlers);
    if (!this.ws) {
      this.connect();
      return;
    }
    if (this.ready) this.enqueueJoin(name);
  }

  leave(channel: string): void {
    const name = normalizeChannel(channel);
    if (!this.channels.delete(name)) return;
    this.joinQueue = this.joinQueue.filter((item) => item !== name);
    this.joined.delete(name);
    if (this.ready) this.send(`PART #${name}`);
    if (this.channels.size === 0) this.close();
  }

  reconnect(): void {
    if (this.channels.size === 0) return;
    this.reconnectNow();
  }

  dispose(): void {
    this.channels.clear();
    this.close();
  }

  private connect(): void {
    if (this.ws) return;
    const ws = this.wsFactory(IRC_URL);
    this.ws = ws;
    this.ready = false;
    ws.onopen = () => this.onOpen(ws);
    ws.onmessage = (event) => this.onData(ws, event.data);
    ws.onclose = () => this.onClosed(ws);
    ws.onerror = () => this.onClosed(ws);
  }

  private onOpen(ws: WsLike): void {
    if (this.ws !== ws) return;
    this.ready = true;
    this.backoff = 0;
    this.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
    this.send('PASS SCHMOOPIIE');
    this.send(`NICK ${this.nick}`);
    for (const channel of this.channels.keys()) this.enqueueJoin(channel);
    this.resetWatchdog();
  }

  private onData(ws: WsLike, raw: unknown): void {
    if (this.ws !== ws) return;
    if (typeof raw !== 'string') return;
    this.resetWatchdog();
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const parsed = parseIrcLine(line);
      if (parsed) this.handleLine(parsed);
    }
  }

  private handleLine(line: IrcLine): void {
    if (line.command === 'PING') {
      this.send('PONG :tmi.twitch.tv');
      return;
    }
    if (line.command === 'RECONNECT') {
      this.reconnectNow();
      return;
    }
    if (line.command === 'PRIVMSG') {
      this.onPrivmsg(line);
      return;
    }
    if (line.command === 'USERNOTICE') {
      this.onUsernotice(line);
      return;
    }
    if (line.command === 'CLEARCHAT') {
      this.onClearchat(line);
      return;
    }
    if (line.command === 'CLEARMSG') {
      this.onClearmsg(line);
      return;
    }
    if (line.command === 'NOTICE') {
      this.onNotice(line);
      return;
    }
    if (line.command === 'JOIN' || line.command === 'ROOMSTATE') {
      this.onJoined(line);
    }
  }

  private onJoined(line: IrcLine): void {
    const channel = normalizeChannel(line.params[0] ?? '');
    if (!channel) return;
    if (line.command === 'JOIN' && loginFromPrefix(line.prefix) !== this.nick) return;
    if (this.joined.has(channel)) return;
    this.joined.add(channel);
    this.channels.get(channel)?.joined?.();
  }

  private onPrivmsg(line: IrcLine): void {
    const channel = normalizeChannel(line.params[0] ?? '');
    const handlers = this.channels.get(channel);
    if (!handlers) return;
    const login = loginFromPrefix(line.prefix);
    const raw = line.params[1] ?? '';
    const action = raw.startsWith('\u0001ACTION ');
    const body = action ? raw.slice('\u0001ACTION '.length).replace(/\u0001$/, '') : raw;
    const segments = segmentText(body, parseEmoteTag(line.tags['emotes'] ?? ''));
    const display = line.tags['display-name'] || login;
    const color = line.tags['color'] ?? '';
    const sent = Number(line.tags['tmi-sent-ts']);
    const ts = Number.isFinite(sent) && sent > 0 ? sent : this.timers.now();
    handlers.message?.({
      id: line.tags['id'] || `${login}-${ts}`,
      ts,
      author: {
        id: login,
        name: display,
        ...(color ? { color } : {}),
        badges: parseBadges(line.tags['badges'] ?? ''),
      },
      segments,
      kind: action ? 'action' : 'message',
      meta: {
        login,
        userId: line.tags['user-id'] ?? '',
        messageType: action ? 'action' : 'text',
        channel,
      },
    });
  }

  private onUsernotice(line: IrcLine): void {
    const channel = normalizeChannel(line.params[0] ?? '');
    const handlers = this.channels.get(channel);
    if (!handlers) return;
    const text = line.tags['system-msg'] ?? '';
    if (!text) return;
    const login = line.tags['login'] || loginFromPrefix(line.prefix) || channel;
    const sent = Number(line.tags['tmi-sent-ts']);
    const ts = Number.isFinite(sent) && sent > 0 ? sent : this.timers.now();
    handlers.notice?.({
      id: line.tags['id'] || `notice-${ts}`,
      ts,
      author: {
        id: line.tags['user-id'] || login,
        name: line.tags['display-name'] || login,
        badges: [],
      },
      segments: [{ t: 'text', text }],
      kind: 'event',
      meta: { login, messageType: line.tags['msg-id'] ?? 'usernotice', channel },
    });
  }

  private onClearchat(line: IrcLine): void {
    const channel = normalizeChannel(line.params[0] ?? '');
    const handlers = this.channels.get(channel);
    if (!handlers) return;
    const target = line.params[1];
    if (target) handlers.clearUser?.(target.toLowerCase());
    else handlers.clearAll?.();
  }

  private onClearmsg(line: IrcLine): void {
    const channel = normalizeChannel(line.params[0] ?? '');
    const handlers = this.channels.get(channel);
    if (!handlers) return;
    const messageId = line.tags['target-msg-id'];
    if (messageId) handlers.deleteMessage?.(messageId);
  }

  private onNotice(line: IrcLine): void {
    const channel = normalizeChannel(line.params[0] ?? '');
    const handlers = this.channels.get(channel);
    if (!handlers) return;
    const reason = NOTICE_ERRORS[line.tags['msg-id'] ?? ''];
    if (reason) handlers.error?.(`Twitch channel '${channel}' ${reason}`);
  }

  private enqueueJoin(channel: string): void {
    if (!this.joinQueue.includes(channel)) this.joinQueue.push(channel);
    this.flushJoins();
  }

  private flushJoins(): void {
    if (!this.ready) return;
    while (this.joinQueue.length > 0) {
      const now = this.timers.now();
      this.joinTimes = this.joinTimes.filter((at) => now - at < JOIN_WINDOW_MS);
      if (this.joinTimes.length >= JOIN_LIMIT) {
        const oldest = this.joinTimes[0] ?? now;
        this.scheduleJoinFlush(JOIN_WINDOW_MS - (now - oldest));
        return;
      }
      const channel = this.joinQueue.shift();
      if (!channel) return;
      this.joinTimes.push(now);
      this.send(`JOIN #${channel}`);
    }
  }

  private scheduleJoinFlush(ms: number): void {
    if (this.joinTimer !== null) return;
    this.joinTimer = this.timers.setTimeout(() => {
      this.joinTimer = null;
      this.flushJoins();
    }, Math.max(0, ms));
  }

  private onClosed(ws: WsLike): void {
    if (this.ws !== ws) return;
    this.ws = null;
    this.ready = false;
    this.joined.clear();
    this.clearWatchdog();
    if (this.channels.size === 0) return;
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.backoff);
    this.backoff = Math.min(this.backoff + 1, MAX_BACKOFF_STEP);
    this.log?.warn('Twitch IRC socket closed, reconnecting');
    this.reconnectTimer = this.timers.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private reconnectNow(): void {
    this.dropSocket();
    this.timers.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.backoff = 0;
    if (this.channels.size === 0) return;
    this.connect();
  }

  private close(): void {
    this.timers.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.timers.clearTimeout(this.joinTimer);
    this.joinTimer = null;
    this.joinQueue = [];
    this.joinTimes = [];
    this.backoff = 0;
    this.clearWatchdog();
    this.dropSocket();
  }

  private dropSocket(): void {
    const ws = this.ws;
    this.ws = null;
    this.ready = false;
    this.joined.clear();
    if (!ws) return;
    ws.onopen = null;
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
    this.watchdog = this.timers.setTimeout(() => {
      this.watchdog = null;
      this.log?.warn('Twitch IRC socket went quiet, reconnecting');
      this.reconnectNow();
    }, WATCHDOG_MS);
  }

  private send(line: string): void {
    const ws = this.ws;
    if (!ws || !this.ready) return;
    ws.send(`${line}\r\n`);
  }
}
