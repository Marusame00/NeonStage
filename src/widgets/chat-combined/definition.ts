import { makeValidator, type DataSourceRequest, type WidgetDefinition } from '../contract';
import { boolField, enumField, strField } from '../fields';
import {
  chatDisplayDefaults,
  chatDisplayFields,
  chatDisplayShape,
  normalizeTwitchChannel,
  type ChatDisplayProps,
} from '../chat/common';

export type ChatCombinedProps = ChatDisplayProps & {
  includeTwitch: boolean;
  twitchChannel: string;
  includeYouTube: boolean;
  youtubeBroadcast: 'mine-active' | 'video';
  youtubeVideoId: string;
  showPlatformIcons: boolean;
};

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export const chatCombinedWidget: WidgetDefinition<ChatCombinedProps> = {
  kind: 'chat-combined',
  version: 1,
  name: 'Combined chat',
  description: 'Twitch and YouTube chat merged into one feed.',
  category: 'chat',
  icon: 'M4 5h16v9h-6l-4 4v-4H4zM8 9h8M8 12h5',
  defaultSize: { w: 460, h: 600 },
  minSize: { w: 180, h: 140 },
  defaultProps: () => ({
    ...chatDisplayDefaults(),
    includeTwitch: true,
    twitchChannel: '',
    includeYouTube: true,
    youtubeBroadcast: 'mine-active',
    youtubeVideoId: '',
    showPlatformIcons: true,
  }),
  fields: [
    { key: 'includeTwitch', label: 'Include Twitch', type: 'boolean', section: 'Sources' },
    { key: 'twitchChannel', label: 'Twitch channel', type: 'text', maxLength: 200, placeholder: 'channel name or twitch.tv link', help: 'Twitch channel name — no sign-in needed', section: 'Sources', showIf: { key: 'includeTwitch', equals: true } },
    { key: 'includeYouTube', label: 'Include YouTube', type: 'boolean', section: 'Sources' },
    { key: 'youtubeBroadcast', label: 'YouTube broadcast', type: 'select', section: 'Sources', options: [
      { value: 'mine-active', label: 'My active broadcast' },
      { value: 'video', label: 'Specific video' },
    ], showIf: { key: 'includeYouTube', equals: true } },
    { key: 'youtubeVideoId', label: 'YouTube video ID', type: 'text', maxLength: 11, section: 'Sources', showIf: { key: 'youtubeBroadcast', equals: 'video' } },
    { key: 'showPlatformIcons', label: 'Show platform icons', type: 'boolean', section: 'Display' },
    ...chatDisplayFields(),
  ],
  styleCapabilities: ['font', 'text', 'background', 'border', 'radius', 'padding', 'glow', 'shadow'],
  validate: makeValidator<ChatCombinedProps>(
    {
      ...chatDisplayDefaults(),
      includeTwitch: true,
      twitchChannel: '',
      includeYouTube: true,
      youtubeBroadcast: 'mine-active',
      youtubeVideoId: '',
      showPlatformIcons: true,
    },
    {
      ...chatDisplayShape(),
      includeTwitch: boolField(true),
      twitchChannel: strField('', 200).transform((value) => normalizeTwitchChannel(value)),
      includeYouTube: boolField(true),
      youtubeBroadcast: enumField(['mine-active', 'video'] as const, 'mine-active'),
      youtubeVideoId: strField('', 11).transform((value) => (VIDEO_ID.test(value) ? value : '')),
      showPlatformIcons: boolField(true),
    },
  ),
  dataSources: (props) => {
    const sources: DataSourceRequest[] = [];
    if (props.includeTwitch) {
      const channel = normalizeTwitchChannel(props.twitchChannel);
      sources.push({
        kind: 'chat',
        provider: 'twitch',
        key: `twitch:${channel || '@me'}`,
        params: { channel },
      });
    }
    if (props.includeYouTube) {
      if (props.youtubeBroadcast === 'video' && props.youtubeVideoId) {
        sources.push({
          kind: 'chat',
          provider: 'youtube',
          key: `youtube:video:${props.youtubeVideoId}`,
          params: { videoId: props.youtubeVideoId },
        });
      } else {
        sources.push({ kind: 'chat', provider: 'youtube', key: 'youtube:mine', params: {} });
      }
    }
    return sources;
  },
};
