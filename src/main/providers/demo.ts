import type { ChatBadge, ChatMessage, ProviderStatus } from '../../shared/chat';
import type { DataSourceRequest } from '../../widgets/contract';
import type { ChatAdapter, ChatSink } from './manager';

export interface DemoTimers {
  setInterval(handler: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

const defaultTimers: DemoTimers = {
  setInterval: (handler, ms) => setInterval(handler, ms),
  clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout),
};

const SAMPLE_MESSAGES = [
  'This is a demo message from NeonStage.',
  'Sample chat keeps your layout visible while you design.',
  'Nothing here is from a real viewer.',
  'Demo messages are labelled and never counted as live chat.',
  'PreviewPilot says the overlay looks good.',
  'This line is placeholder text for your chat widget.',
  'SampleSynth is testing message spacing.',
  'DemoViewer is a made-up account.',
  'MockModerator would delete this if it were real.',
  'Your real chat appears here once a provider is connected.',
  'Another sample line to fill the feed.',
  'Demo mode cycles through a fixed list of messages.',
  'This message exists so you can judge font size.',
  'Placeholder text for the combined chat widget.',
  'Sample chat scrolls at a steady pace.',
  'DemoViewer is not a real person.',
  'This is the sixteenth sample message.',
  'Use demo mode to check colours and badges.',
  'SampleSynth is checking the timestamp column.',
  'MockModerator is a demo badge holder.',
  'PreviewPilot is testing long messages that wrap onto a second line in narrow widgets.',
  'Demo chat stops when the widget is removed.',
  'This sample line is intentionally boring.',
  'Placeholder chatter for layout work.',
];

interface DemoAuthor {
  id: string;
  name: string;
  color: string;
  badge: ChatBadge;
}

const TWITCH_AUTHORS: DemoAuthor[] = [
  { id: 'demo-viewer', name: 'DemoViewer', color: '#3ff2ff', badge: { id: 'broadcaster', label: 'Broadcaster' } },
  { id: 'sample-synth', name: 'SampleSynth', color: '#ff3fd2', badge: { id: 'subscriber', label: 'Sub' } },
  { id: 'preview-pilot', name: 'PreviewPilot', color: '#ffb03f', badge: { id: 'vip', label: 'VIP' } },
  { id: 'mock-moderator', name: 'MockModerator', color: '#7cff6b', badge: { id: 'moderator', label: 'Mod' } },
];

const YOUTUBE_AUTHORS: DemoAuthor[] = [
  { id: 'demo-viewer', name: 'DemoViewer', color: '#3ff2ff', badge: { id: 'owner', label: 'Owner' } },
  { id: 'sample-synth', name: 'SampleSynth', color: '#ff3fd2', badge: { id: 'member', label: 'Member' } },
  { id: 'preview-pilot', name: 'PreviewPilot', color: '#ffb03f', badge: { id: 'verified', label: 'Verified' } },
  { id: 'mock-moderator', name: 'MockModerator', color: '#7cff6b', badge: { id: 'moderator', label: 'Moderator' } },
];

interface DemoSession {
  req: DataSourceRequest;
  sink: ChatSink;
  index: number;
  handle: unknown;
}

let messageCounter = 0;

export class DemoChatAdapter implements ChatAdapter {
  private readonly sessions = new Map<string, DemoSession>();

  constructor(
    private readonly platform: 'twitch' | 'youtube',
    private readonly timers: DemoTimers = defaultTimers,
  ) {}

  start(req: DataSourceRequest, sink: ChatSink): void {
    if (this.sessions.has(req.key)) return;
    const session: DemoSession = { req, sink, index: 0, handle: null };
    this.sessions.set(req.key, session);
    sink.sourceState(req.key, 'demo');
    for (let i = 0; i < 3; i += 1) {
      sink.ops([{ t: 'add', sourceKey: req.key, message: this.next(session) }]);
    }
    session.handle = this.timers.setInterval(() => {
      sink.ops([{ t: 'add', sourceKey: req.key, message: this.next(session) }]);
    }, 2400);
  }

  stop(key: string): void {
    const session = this.sessions.get(key);
    if (!session) return;
    this.timers.clearInterval(session.handle);
    this.sessions.delete(key);
  }

  status(): ProviderStatus | null {
    return null;
  }

  dispose(): void {
    for (const key of [...this.sessions.keys()]) this.stop(key);
  }

  private next(session: DemoSession): ChatMessage {
    const index = session.index;
    session.index += 1;
    const authors = this.platform === 'twitch' ? TWITCH_AUTHORS : YOUTUBE_AUTHORS;
    const author = authors[index % authors.length]!;
    const text = SAMPLE_MESSAGES[index % SAMPLE_MESSAGES.length]!;
    const isAction = index > 0 && index % 7 === 3;
    const isSuperChat = this.platform === 'youtube' && index === 5;
    messageCounter += 1;

    const message: ChatMessage = {
      id: `${session.req.key}-demo-${index}-${messageCounter}`,
      sourceKey: session.req.key,
      platform: this.platform,
      demo: true,
      ts: Date.now(),
      author: {
        id: author.id,
        name: author.name,
        color: author.color,
        badges: [{ ...author.badge }],
      },
      segments: [{ t: 'text', text: isAction ? `* ${text}` : text }],
      kind: isAction ? 'action' : 'message',
      meta: { demo: true },
    };
    if (isSuperChat) message.amountText = 'DEMO $5.00';
    return message;
  }
}
