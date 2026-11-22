import { memo, useMemo, type CSSProperties, type ReactNode } from 'react';
import { isAllowedMediaUrl, type ChatBadge, type ChatMessage, type ChatPlatform, type ChatSegment } from '../../shared/chat';
import type { NodeStyle } from '../../shared/model';
import type { OutputNode } from '../../shared/output';
import { useChatSources, useRenderContext, useServerNow, useSourceStatus } from '../../render/RenderContext';
import { hexToRgba } from '../../render/style';
import { getWidget } from '../registry';
import type { ChatDisplayProps } from './common';

export interface ChatListProps {
  node: OutputNode;
  props: ChatDisplayProps;
  style: NodeStyle;
  mode: 'editor' | 'output';
  width: number;
  height: number;
  demo: boolean;
  showPlatformIcons: boolean;
}

const chipStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 16,
  height: 16,
  padding: '0 3px',
  borderRadius: 3,
  fontSize: 10,
  lineHeight: 1,
  fontWeight: 700,
  background: 'rgba(255, 255, 255, 0.16)',
  color: 'rgba(255, 255, 255, 0.92)',
};

const tagStyle: CSSProperties = {
  position: 'absolute',
  top: 2,
  right: 2,
  padding: '1px 5px',
  borderRadius: 3,
  fontSize: 9,
  letterSpacing: 0.6,
  fontWeight: 700,
  background: 'rgba(255, 63, 210, 0.85)',
  color: '#120a24',
  pointerEvents: 'none',
};

const captionStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  height: '100%',
  opacity: 0.55,
  fontSize: '0.8em',
  textAlign: 'center',
};

export function chatSourceKeys(kind: string, props: Record<string, unknown>): string[] {
  const definition = getWidget(kind);
  if (!definition?.dataSources) return [];
  return definition.dataSources(definition.validate(props)).map((request) => request.key);
}

function providerLabel(keys: string[]): string {
  if (keys.some((key) => key.startsWith('twitch:'))) return 'Twitch';
  if (keys.some((key) => key.startsWith('youtube:'))) return 'YouTube';
  return 'chat';
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function formatTime(ts: number): string {
  const date = new Date(ts);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function readableColor(hex: string): string {
  const value = hex.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return hex;
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  if (luminance >= 0.35) return hex;
  const t = (0.35 - luminance) / (1 - luminance);
  const mix = (channel: number): number => Math.round(channel + (255 - channel) * t);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

function BadgeGlyph({ badge }: { badge: ChatBadge }): ReactNode {
  const id = badge.id.toLowerCase();
  const stroke = 'rgba(255, 255, 255, 0.92)';
  if (id.includes('broadcaster') || id.includes('owner')) {
    return (
      <svg width={10} height={10} viewBox="0 0 10 10" aria-hidden="true">
        <path d="M1 8h8L8 3 6 5 5 2 4 5 2 3z" fill={stroke} />
      </svg>
    );
  }
  if (id.includes('moderator') || id.includes('mod')) {
    return (
      <svg width={10} height={10} viewBox="0 0 10 10" aria-hidden="true">
        <path d="M5 1l4 1.5v3.2C9 7.4 7.3 8.6 5 9 2.7 8.6 1 7.4 1 5.7V2.5z" fill={stroke} />
      </svg>
    );
  }
  if (id.includes('subscriber') || id.includes('member') || id.includes('sub')) {
    return (
      <svg width={10} height={10} viewBox="0 0 10 10" aria-hidden="true">
        <path d="M5 1l1.2 2.6L9 4l-2 2 .5 2.9L5 7.5 2.5 8.9 3 6 1 4l2.8-.4z" fill={stroke} />
      </svg>
    );
  }
  if (id.includes('vip')) {
    return (
      <svg width={10} height={10} viewBox="0 0 10 10" aria-hidden="true">
        <path d="M5 1l3 4-3 4-3-4z" fill={stroke} />
      </svg>
    );
  }
  if (id.includes('verified')) {
    return (
      <svg width={10} height={10} viewBox="0 0 10 10" aria-hidden="true">
        <path d="M1.5 5.5l2 2 5-5" fill="none" stroke={stroke} strokeWidth={1.6} />
      </svg>
    );
  }
  return <>{badge.label.slice(0, 2).toUpperCase()}</>;
}

function Badge({ badge }: { badge: ChatBadge }): ReactNode {
  if (badge.imageUrl && isAllowedMediaUrl(badge.imageUrl)) {
    return (
      <img
        src={badge.imageUrl}
        alt={badge.label}
        style={{ width: 18, height: 18, verticalAlign: 'middle', borderRadius: 2 }}
      />
    );
  }
  return (
    <span style={chipStyle} title={badge.label}>
      <BadgeGlyph badge={badge} />
    </span>
  );
}

function PlatformIcon({ platform }: { platform: ChatPlatform }): ReactNode {
  if (platform === 'twitch') {
    return (
      <span
        style={{
          ...chipStyle,
          background: '#9146ff',
          color: '#ffffff',
          borderRadius: 4,
          width: 16,
          padding: 0,
        }}
        aria-label="Twitch"
      >
        T
      </span>
    );
  }
  if (platform === 'youtube') {
    return (
      <span
        style={{
          ...chipStyle,
          background: '#ff0033',
          borderRadius: 4,
          width: 16,
          padding: 0,
        }}
        aria-label="YouTube"
      >
        <svg width={8} height={8} viewBox="0 0 8 8" aria-hidden="true">
          <path d="M2 1l5 3-5 3z" fill="#ffffff" />
        </svg>
      </span>
    );
  }
  return null;
}

function Segment({ segment, showEmotes }: { segment: ChatSegment; showEmotes: boolean }): ReactNode {
  if (segment.t === 'emote') {
    if (showEmotes && isAllowedMediaUrl(segment.url)) {
      return (
        <img
          src={segment.url}
          alt={segment.name}
          style={{ height: '1.6em', verticalAlign: 'middle' }}
        />
      );
    }
    return <>{segment.name}</>;
  }
  if (segment.t === 'mention') return <strong>{segment.text}</strong>;
  return <>{segment.text}</>;
}

interface RowProps {
  message: ChatMessage;
  style: NodeStyle;
  bubble: boolean;
  showTimestamps: boolean;
  showBadges: boolean;
  showEmotes: boolean;
  useUserColors: boolean;
  showPlatformIcons: boolean;
  fading: boolean;
  animate: boolean;
}

const ChatRow = memo(
  function ChatRow({
    message,
    style,
    bubble,
    showTimestamps,
    showBadges,
    showEmotes,
    useUserColors,
    showPlatformIcons,
    fading,
    animate,
  }: RowProps): ReactNode {
    const color = useUserColors && message.author.color ? readableColor(message.author.color) : undefined;
    const action = message.kind === 'action';
    const rowClass = fading ? 'ns-anim ns-chat-fade-out' : animate ? 'ns-anim ns-chat-row' : undefined;

    return (
      <div
        className={rowClass}
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'baseline',
          columnGap: 4,
          rowGap: 2,
          padding: bubble ? '3px 7px' : undefined,
          borderRadius: bubble ? 6 : undefined,
          background: bubble ? hexToRgba(style.bgColor, Math.max(style.bgOpacity, 0.35)) : undefined,
        }}
      >
        {showTimestamps ? (
          <span style={{ opacity: 0.6, fontSize: '0.8em', fontVariantNumeric: 'tabular-nums' }}>
            {formatTime(message.ts)}
          </span>
        ) : null}
        {showPlatformIcons ? <PlatformIcon platform={message.platform} /> : null}
        {showBadges
          ? message.author.badges.map((badge, index) => <Badge key={`${badge.id}-${index}`} badge={badge} />)
          : null}
        <span style={{ color, fontWeight: 700, fontStyle: action ? 'italic' : undefined }}>
          {message.author.name}
        </span>
        <span style={{ fontStyle: action ? 'italic' : undefined, color: action ? color : undefined }}>
          {message.segments.map((segment, index) => (
            <Segment key={index} segment={segment} showEmotes={showEmotes} />
          ))}
        </span>
        {message.amountText ? <span style={chipStyle}>{message.amountText}</span> : null}
      </div>
    );
  },
  (previous, next) =>
    previous.message === next.message &&
    previous.fading === next.fading &&
    previous.bubble === next.bubble &&
    previous.showTimestamps === next.showTimestamps &&
    previous.showBadges === next.showBadges &&
    previous.showEmotes === next.showEmotes &&
    previous.useUserColors === next.useUserColors &&
    previous.showPlatformIcons === next.showPlatformIcons &&
    previous.animate === next.animate &&
    previous.style === next.style,
);

export function ChatList({
  node,
  props,
  style,
  mode,
  width,
  height,
  demo,
  showPlatformIcons,
}: ChatListProps): ReactNode {
  const widget = node.widget;
  const { reduceMotion } = useRenderContext();
  const animate = style.animate && !reduceMotion;
  const keys = useMemo(
    () => (widget ? chatSourceKeys(widget.kind, widget.props) : []),
    [widget],
  );
  const messages = useChatSources(keys);
  const statuses = useSourceStatus(keys);
  const fading = props.fadeAfterSec > 0;
  const serverNow = useServerNow(fading ? 1000 : 0);

  const visible = useMemo(() => {
    let list = messages;
    if (fading) {
      const limit = props.fadeAfterSec * 1000;
      list = list.filter((message) => serverNow - message.ts <= limit);
    }
    if (list.length > props.maxMessages) list = list.slice(list.length - props.maxMessages);
    return props.direction === 'down' ? [...list].reverse() : list;
  }, [messages, fading, serverNow, props.fadeAfterSec, props.maxMessages, props.direction]);

  const rows = visible.map((message) => (
    <ChatRow
      key={message.id}
      message={message}
      style={style}
      bubble={props.bubble}
      showTimestamps={props.showTimestamps}
      showBadges={props.showBadges}
      showEmotes={props.showEmotes}
      useUserColors={props.useUserColors}
      showPlatformIcons={showPlatformIcons}
      fading={fading && serverNow - message.ts > props.fadeAfterSec * 1000 - 600}
      animate={animate}
    />
  ));

  const containerStyle: CSSProperties = {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: props.direction === 'up' ? 'flex-end' : 'flex-start',
    gap: props.messageGap,
    width,
    height,
    overflow: 'hidden',
  };

  if (demo) {
    if (mode === 'output' && !props.showDemoInOutput) return null;
    return (
      <div style={containerStyle}>
        {rows}
        <span style={tagStyle}>{mode === 'editor' ? 'DEMO DATA — not live' : 'DEMO'}</span>
      </div>
    );
  }

  const liveKeys = keys.filter((key) => statuses[key] === 'live');
  const unavailable = keys.length === 0 || liveKeys.length === 0;

  if (unavailable && props.onUnavailable === 'hide') {
    if (mode === 'output') return null;
    return (
      <div style={containerStyle}>
        <div style={captionStyle}>{`Waiting for ${providerLabel(keys)} chat…`}</div>
      </div>
    );
  }

  if (unavailable && props.onUnavailable === 'message') {
    return (
      <div style={containerStyle}>
        <div style={captionStyle}>{props.unavailableText}</div>
      </div>
    );
  }

  return <div style={containerStyle}>{rows}</div>;
}
