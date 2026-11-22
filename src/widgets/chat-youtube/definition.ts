import { makeValidator, type WidgetDefinition } from '../contract';
import { enumField, strField } from '../fields';
import {
  chatDisplayDefaults,
  chatDisplayFields,
  chatDisplayShape,
  type ChatDisplayProps,
} from '../chat/common';

export type ChatYouTubeProps = ChatDisplayProps & {
  source: 'demo' | 'live';
  broadcast: 'mine-active' | 'video';
  videoId: string;
};

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export const chatYouTubeWidget: WidgetDefinition<ChatYouTubeProps> = {
  kind: 'chat-youtube',
  version: 1,
  name: 'YouTube chat',
  description: 'YouTube live chat from your active broadcast or a video.',
  category: 'chat',
  icon: 'M3 7h18v10H3zM10 10l5 2-5 2z',
  defaultSize: { w: 420, h: 560 },
  minSize: { w: 160, h: 120 },
  defaultProps: () => ({ ...chatDisplayDefaults(), source: 'demo', broadcast: 'mine-active', videoId: '' }),
  fields: [
    { key: 'source', label: 'Source', type: 'select', options: [
      { value: 'demo', label: 'Demo messages' },
      { value: 'live', label: 'Live chat' },
    ] },
    { key: 'broadcast', label: 'Broadcast', type: 'select', options: [
      { value: 'mine-active', label: 'My active broadcast' },
      { value: 'video', label: 'Specific video' },
    ], showIf: { key: 'source', equals: 'live' } },
    { key: 'videoId', label: 'Video ID', type: 'text', maxLength: 11, showIf: { key: 'broadcast', equals: 'video' } },
    ...chatDisplayFields(),
  ],
  styleCapabilities: ['font', 'text', 'background', 'border', 'radius', 'padding', 'glow', 'shadow'],
  validate: makeValidator<ChatYouTubeProps>(
    { ...chatDisplayDefaults(), source: 'demo', broadcast: 'mine-active', videoId: '' },
    {
      ...chatDisplayShape(),
      source: enumField(['demo', 'live'] as const, 'demo'),
      broadcast: enumField(['mine-active', 'video'] as const, 'mine-active'),
      videoId: strField('', 11).transform((value) => (VIDEO_ID.test(value) ? value : '')),
    },
  ),
  dataSources: (props) => {
    if (props.source === 'demo') {
      return [{ kind: 'chat', provider: 'demo-youtube', key: 'demo:youtube', params: {} }];
    }
    if (props.broadcast === 'video' && props.videoId) {
      return [
        {
          kind: 'chat',
          provider: 'youtube',
          key: `youtube:video:${props.videoId}`,
          params: { videoId: props.videoId },
        },
      ];
    }
    return [{ kind: 'chat', provider: 'youtube', key: 'youtube:mine', params: {} }];
  },
};
