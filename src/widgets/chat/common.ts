import type { ZodType } from 'zod';
import type { FieldSpec } from '../contract';
import { boolField, enumField, numField, strField } from '../fields';

export type ChatDisplayProps = {
  maxMessages: number;
  showTimestamps: boolean;
  showBadges: boolean;
  showEmotes: boolean;
  useUserColors: boolean;
  fadeAfterSec: number;
  messageGap: number;
  direction: 'up' | 'down';
  onUnavailable: 'hide' | 'keep-last' | 'message';
  unavailableText: string;
  showDemoInOutput: boolean;
  bubble: boolean;
  areaTop: number;
  areaRight: number;
  areaBottom: number;
  areaLeft: number;
};

export function chatDisplayDefaults(): ChatDisplayProps {
  return {
    maxMessages: 12,
    showTimestamps: false,
    showBadges: true,
    showEmotes: true,
    useUserColors: true,
    fadeAfterSec: 0,
    messageGap: 6,
    direction: 'up',
    onUnavailable: 'hide',
    unavailableText: 'Chat unavailable',
    showDemoInOutput: false,
    bubble: false,
    areaTop: 0,
    areaRight: 0,
    areaBottom: 0,
    areaLeft: 0,
  };
}

export function chatDisplayFields(): FieldSpec[] {
  return [
    { key: 'maxMessages', label: 'Max messages', type: 'number', min: 1, max: 50, step: 1, section: 'Display' },
    { key: 'direction', label: 'Newest message', type: 'select', section: 'Display', options: [
      { value: 'up', label: 'At the bottom' },
      { value: 'down', label: 'At the top' },
    ] },
    { key: 'messageGap', label: 'Message gap', type: 'number', min: 0, max: 40, step: 1, unit: 'px', section: 'Display' },
    { key: 'fadeAfterSec', label: 'Fade after', type: 'number', min: 0, max: 600, step: 1, unit: 's', section: 'Display', help: '0 keeps messages visible.' },
    { key: 'bubble', label: 'Bubble background', type: 'boolean', section: 'Display' },
    { key: 'showTimestamps', label: 'Show timestamps', type: 'boolean', section: 'Display' },
    { key: 'showBadges', label: 'Show badges', type: 'boolean', section: 'Display' },
    { key: 'showEmotes', label: 'Show emotes', type: 'boolean', section: 'Display' },
    { key: 'useUserColors', label: 'Use user colors', type: 'boolean', section: 'Display' },
    { key: 'showDemoInOutput', label: 'Show demo messages in output', type: 'boolean', section: 'Display' },
    { key: 'onUnavailable', label: 'When unavailable', type: 'select', section: 'Fallback', options: [
      { value: 'hide', label: 'Hide the widget' },
      { value: 'keep-last', label: 'Keep last messages' },
      { value: 'message', label: 'Show a message' },
    ] },
    { key: 'unavailableText', label: 'Unavailable text', type: 'text', maxLength: 200, section: 'Fallback', showIf: { key: 'onUnavailable', equals: 'message' } },
    { key: 'areaTop', label: 'Top inset', type: 'number', min: 0, max: 4000, step: 1, unit: 'px', section: 'Message area', help: 'Moves the messages inside the chat window. Drag the dashed box on the canvas, or type values here.' },
    { key: 'areaRight', label: 'Right inset', type: 'number', min: 0, max: 4000, step: 1, unit: 'px', section: 'Message area' },
    { key: 'areaBottom', label: 'Bottom inset', type: 'number', min: 0, max: 4000, step: 1, unit: 'px', section: 'Message area' },
    { key: 'areaLeft', label: 'Left inset', type: 'number', min: 0, max: 4000, step: 1, unit: 'px', section: 'Message area' },
  ];
}

const TWITCH_CHANNEL = /^[a-z0-9_]{1,25}$/;

export function normalizeTwitchChannel(value: string): string {
  let name = value.trim().toLowerCase();
  if (!name) return '';
  name = name.replace(/^#/, '');
  name = name.replace(/^https?:\/\/(?:www\.)?twitch\.tv\//, '');
  name = name.replace(/^twitch\.tv\//, '');
  name = name.split(/[/?#]/)[0] ?? '';
  return TWITCH_CHANNEL.test(name) ? name : '';
}

export function chatDisplayShape(): Record<string, ZodType> {
  return {
    maxMessages: numField(12, 1, 50),
    showTimestamps: boolField(false),
    showBadges: boolField(true),
    showEmotes: boolField(true),
    useUserColors: boolField(true),
    fadeAfterSec: numField(0, 0, 600),
    messageGap: numField(6, 0, 40),
    direction: enumField(['up', 'down'] as const, 'up'),
    onUnavailable: enumField(['hide', 'keep-last', 'message'] as const, 'hide'),
    unavailableText: strField('Chat unavailable', 200),
    showDemoInOutput: boolField(false),
    bubble: boolField(false),
    areaTop: numField(0, 0, 4000),
    areaRight: numField(0, 0, 4000),
    areaBottom: numField(0, 0, 4000),
    areaLeft: numField(0, 0, 4000),
  };
}
