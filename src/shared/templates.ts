import { addNode, createWidgetNode, groupNodes, type WidgetNodeOverrides } from './ops';
import { createScene, type Scene } from './model';
import type { Rect } from './geometry';

export interface Template {
  id: string;
  name: string;
  description: string;
  build(w: number, h: number): Scene;
}

class SceneBuilder {
  scene: Scene;

  constructor(name: string, w: number, h: number) {
    this.scene = createScene(name, w, h);
  }

  add(kind: string, rect: Rect, overrides: WidgetNodeOverrides = {}): string {
    const node = createWidgetNode(kind, rect.x, rect.y, { ...overrides, w: rect.w, h: rect.h });
    this.scene = addNode(this.scene, node);
    return node.id;
  }

  group(ids: string[], name: string): string {
    const result = groupNodes(this.scene, ids, name);
    this.scene = result.scene;
    return result.groupId;
  }
}

function synthwaveGameplay(w: number, h: number, withYouTube = false): Scene {
  const builder = new SceneBuilder(withYouTube ? 'Synthwave gameplay (Twitch + YouTube)' : 'Synthwave gameplay', w, h);

  const grid = builder.add(
    'shape',
    { x: 0, y: h * 0.73, w: w * 0.66, h: h * 0.14 },
    {
      props: {
        shape: 'grid',
        fillColor: '#3ff2ff',
        fillOpacity: 0.1,
        strokeColor: '#3ff2ff',
        strokeOpacity: 0.25,
        strokeWidth: 1,
      },
      name: 'Grid lines',
    },
  );
  builder.group([grid], 'Background');

  const game = builder.add(
    'frame',
    { x: w * 0.04, y: h * 0.1, w: w * 0.6, h: h * 0.62 },
    {
      props: {
        purpose: 'game',
        style: 'neon',
        strokeColor: '#ff3fd2',
        strokeColor2: '#3ff2ff',
        strokeWidth: 4,
        label: 'GAME',
      },
      style: { glowEnabled: true, glowColor: '#ff3fd2', glowSize: 10, radius: 6 },
      name: 'Game frame',
    },
  );
  const webcam = builder.add(
    'frame',
    { x: w * 0.68, y: h * 0.06, w: w * 0.28, h: h * 0.3 },
    {
      props: {
        purpose: 'webcam',
        style: 'brackets',
        strokeColor: '#3ff2ff',
        strokeColor2: '#ff3fd2',
        strokeWidth: 3,
        label: 'CAM',
      },
      style: { radius: 4 },
      name: 'Webcam frame',
    },
  );
  const chatRect = { x: w * 0.68, y: h * 0.39, w: w * 0.28, h: h * 0.45 };
  const chatStyle = {
    bgColor: '#120a24',
    bgOpacity: 0.55,
    radius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#3ff2ff',
    borderOpacity: 0.35,
    fontSize: 20,
  };
  const chatProps = { source: 'demo', maxMessages: 12, bubble: true, onUnavailable: 'hide' };
  const chatTwitch = builder.add('chat-twitch', chatRect, {
    props: chatProps,
    style: chatStyle,
    name: 'Twitch chat',
  });
  const chats = [chatTwitch];
  if (withYouTube) {
    chats.push(
      builder.add('chat-youtube', chatRect, {
        props: chatProps,
        style: { ...chatStyle, borderColor: '#ff3fd2' },
        name: 'YouTube chat',
        visible: false,
      }),
    );
  }
  const title = builder.add(
    'text',
    { x: w * 0.04, y: h * 0.76, w: w * 0.6, h: h * 0.08 },
    {
      props: { text: 'NeonStage', uppercase: true, verticalAlign: 'middle' },
      style: { fontSize: 48, fontWeight: 800, letterSpacing: 2, textColor: '#ffffff' },
      name: 'Title',
    },
  );
  const ticker = builder.add(
    'ticker',
    { x: w * 0.04, y: h * 0.88, w: w * 0.92, h: h * 0.07 },
    {
      props: { items: ['Welcome to the stream', 'Follow for more', '!commands'], speed: 70 },
      style: {
        bgColor: '#120a24',
        bgOpacity: 0.7,
        radius: 6,
        padding: 8,
        borderWidth: 1,
        borderColor: '#ff3fd2',
        borderOpacity: 0.4,
        fontSize: 24,
      },
      name: 'Ticker',
    },
  );
  builder.group([game, webcam, ...chats, title, ticker], 'Front');

  return builder.scene;
}

function minimalMono(w: number, h: number): Scene {
  const builder = new SceneBuilder('Minimal mono', w, h);

  const game = builder.add(
    'frame',
    { x: w * 0.05, y: h * 0.08, w: w * 0.62, h: h * 0.66 },
    {
      props: {
        purpose: 'game',
        style: 'minimal',
        strokeColor: '#e6e6e6',
        strokeColor2: '#9a9a9a',
        strokeWidth: 2,
        cornerSize: 0,
        label: 'GAME',
      },
      style: { radius: 2 },
      name: 'Game frame',
    },
  );
  const webcam = builder.add(
    'frame',
    { x: w * 0.7, y: h * 0.08, w: w * 0.25, h: h * 0.28 },
    {
      props: {
        purpose: 'webcam',
        style: 'minimal',
        strokeColor: '#e6e6e6',
        strokeColor2: '#9a9a9a',
        strokeWidth: 2,
        cornerSize: 0,
        label: 'CAM',
      },
      style: { radius: 2 },
      name: 'Webcam frame',
    },
  );
  builder.group([game, webcam], 'Frames');

  builder.add(
    'text',
    { x: w * 0.05, y: h * 0.76, w: w * 0.4, h: h * 0.06 },
    {
      props: { text: 'Live', uppercase: true, verticalAlign: 'middle' },
      style: { fontSize: 28, fontWeight: 400, letterSpacing: 6, textColor: '#e6e6e6' },
      name: 'Live label',
    },
  );
  builder.add(
    'clock',
    { x: w * 0.7, y: h * 0.4, w: w * 0.25, h: h * 0.08 },
    {
      props: { mode: 'session-elapsed', showSeconds: true, label: 'Session', showLabel: true },
      style: { fontSize: 28, fontWeight: 300, textAlign: 'right', textColor: '#e6e6e6' },
      name: 'Session clock',
    },
  );
  builder.add(
    'goal',
    { x: w * 0.05, y: h * 0.86, w: w * 0.4, h: h * 0.08 },
    {
      props: {
        title: 'Followers',
        target: 500,
        barColor: '#e6e6e6',
        barColor2: '#9a9a9a',
        trackColor: '#2a2a2a',
        trackOpacity: 0.4,
        barHeight: 6,
        showPercent: false,
      },
      style: { fontSize: 20, textColor: '#e6e6e6' },
      name: 'Goal bar',
    },
  );

  return builder.scene;
}

function colorfulJustChatting(w: number, h: number): Scene {
  const builder = new SceneBuilder('Colorful just chatting', w, h);

  const chatTwitch = builder.add(
    'chat-twitch',
    { x: w * 0.06, y: h * 0.14, w: w * 0.52, h: h * 0.35 },
    {
      props: { source: 'demo', maxMessages: 8, bubble: true, messageGap: 8, onUnavailable: 'hide' },
      style: {
        bgColor: '#2a1a4a',
        bgOpacity: 0.75,
        radius: 22,
        padding: 18,
        borderWidth: 2,
        borderColor: '#ff8fd0',
        borderOpacity: 0.6,
        fontSize: 24,
        textColor: '#ffe6f7',
      },
      name: 'Twitch chat',
    },
  );
  const chatYouTube = builder.add(
    'chat-youtube',
    { x: w * 0.06, y: h * 0.5, w: w * 0.52, h: h * 0.35 },
    {
      props: { source: 'demo', maxMessages: 8, bubble: true, messageGap: 8, onUnavailable: 'hide' },
      style: {
        bgColor: '#2a1a4a',
        bgOpacity: 0.75,
        radius: 22,
        padding: 18,
        borderWidth: 2,
        borderColor: '#8fd0ff',
        borderOpacity: 0.6,
        fontSize: 24,
        textColor: '#ffe6f7',
      },
      name: 'YouTube chat',
    },
  );
  const timer = builder.add(
    'timer',
    { x: w * 0.62, y: h * 0.14, w: w * 0.32, h: h * 0.18 },
    {
      props: { mode: 'countdown', durationMs: 600_000, label: 'Starts in', showLabel: true },
      style: {
        bgColor: '#3a1f5c',
        bgOpacity: 0.8,
        radius: 18,
        padding: 12,
        textColor: '#ffe6f7',
        fontSize: 40,
        textAlign: 'center',
      },
      name: 'Countdown',
    },
  );
  const goal = builder.add(
    'goal',
    { x: w * 0.62, y: h * 0.36, w: w * 0.32, h: h * 0.16 },
    {
      props: {
        title: 'Sub goal',
        target: 100,
        barColor: '#ff8fd0',
        barColor2: '#8fd0ff',
        trackColor: '#1b1030',
        barHeight: 14,
      },
      style: {
        bgColor: '#3a1f5c',
        bgOpacity: 0.8,
        radius: 18,
        padding: 12,
        textColor: '#ffe6f7',
        fontSize: 22,
      },
      name: 'Goal',
    },
  );
  const title = builder.add(
    'text',
    { x: w * 0.62, y: h * 0.56, w: w * 0.32, h: h * 0.1 },
    {
      props: { text: 'Just Chatting', verticalAlign: 'middle' },
      style: { fontSize: 34, fontWeight: 700, textColor: '#ffe6f7', textAlign: 'center' },
      name: 'Title',
    },
  );
  const ticker = builder.add(
    'ticker',
    { x: w * 0.06, y: h * 0.9, w: w * 0.88, h: h * 0.06 },
    {
      props: { items: ['Say hi in chat', '!socials', 'Be kind'], speed: 50 },
      style: {
        bgColor: '#2a1a4a',
        bgOpacity: 0.8,
        radius: 16,
        padding: 8,
        textColor: '#ffe6f7',
        fontSize: 22,
      },
      name: 'Ticker',
    },
  );
  builder.group([chatTwitch, chatYouTube, timer, goal, title, ticker], 'Front');

  return builder.scene;
}

export const TEMPLATES: Template[] = [
  {
    id: 'synthwave-gameplay',
    name: 'Synthwave gameplay',
    description: 'Neon game and webcam frames with a full-height Twitch chat, title and ticker.',
    build: (w, h) => synthwaveGameplay(w, h),
  },
  {
    id: 'synthwave-dual-chat',
    name: 'Synthwave gameplay (Twitch + YouTube)',
    description: 'Same layout with full-size Twitch and YouTube chats; YouTube starts hidden.',
    build: (w, h) => synthwaveGameplay(w, h, true),
  },
  {
    id: 'minimal-mono',
    name: 'Minimal mono',
    description: 'Thin white frames, a session clock and a quiet goal bar.',
    build: minimalMono,
  },
  {
    id: 'colorful-just-chatting',
    name: 'Colorful just chatting',
    description: 'Rounded pastel panels with a large chat, countdown and ticker.',
    build: colorfulJustChatting,
  },
];
