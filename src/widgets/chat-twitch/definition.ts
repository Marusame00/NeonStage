import { makeValidator, type WidgetDefinition } from '../contract';
import { enumField, strField } from '../fields';
import {
  chatDisplayDefaults,
  chatDisplayFields,
  chatDisplayShape,
  normalizeTwitchChannel,
  type ChatDisplayProps,
} from '../chat/common';

export type ChatTwitchProps = ChatDisplayProps & {
  source: 'demo' | 'live';
  channel: string;
};

export const chatTwitchWidget: WidgetDefinition<ChatTwitchProps> = {
  kind: 'chat-twitch',
  version: 1,
  name: 'Twitch chat',
  description: 'Twitch chat from your channel or a demo feed.',
  category: 'chat',
  icon: 'M4 4h16v10l-4 4h-4l-3 3H7v-3H4z',
  defaultSize: { w: 420, h: 560 },
  minSize: { w: 160, h: 120 },
  defaultProps: () => ({ ...chatDisplayDefaults(), source: 'demo', channel: '' }),
  fields: [
    { key: 'source', label: 'Source', type: 'select', options: [
      { value: 'demo', label: 'Demo messages' },
      { value: 'live', label: 'Live channel' },
    ] },
    { key: 'channel', label: 'Channel', type: 'text', maxLength: 200, placeholder: 'channel name or twitch.tv link', help: 'Twitch channel name — no sign-in needed', showIf: { key: 'source', equals: 'live' } },
    ...chatDisplayFields(),
  ],
  styleCapabilities: ['font', 'text', 'background', 'border', 'radius', 'padding', 'glow', 'shadow'],
  validate: makeValidator<ChatTwitchProps>(
    { ...chatDisplayDefaults(), source: 'demo', channel: '' },
    {
      ...chatDisplayShape(),
      source: enumField(['demo', 'live'] as const, 'demo'),
      channel: strField('', 200).transform((value) => normalizeTwitchChannel(value)),
    },
  ),
  dataSources: (props) =>
    props.source === 'demo'
      ? [{ kind: 'chat', provider: 'demo-twitch', key: 'demo:twitch', params: {} }]
      : [
          {
            kind: 'chat',
            provider: 'twitch',
            key: `twitch:${normalizeTwitchChannel(props.channel) || '@me'}`,
            params: { channel: normalizeTwitchChannel(props.channel) },
          },
        ],
};
