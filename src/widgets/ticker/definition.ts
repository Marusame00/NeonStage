import { makeValidator, type WidgetDefinition } from '../contract';
import { enumField, numField, strField, strListField } from '../fields';

export type TickerProps = {
  items: string[];
  separator: string;
  speed: number;
  direction: 'left' | 'right';
  mode: 'scroll' | 'rotate';
  rotateSeconds: number;
};

export const tickerWidget: WidgetDefinition<TickerProps> = {
  kind: 'ticker',
  version: 1,
  name: 'Ticker',
  description: 'Scrolling or rotating line of announcements.',
  category: 'text',
  icon: 'M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4',
  defaultSize: { w: 1200, h: 64 },
  minSize: { w: 120, h: 24 },
  defaultProps: () => ({
    items: ['Welcome to NeonStage', 'Follow for more', '!commands'],
    separator: '  ✦  ',
    speed: 60,
    direction: 'left',
    mode: 'scroll',
    rotateSeconds: 6,
  }),
  fields: [
    { key: 'items', label: 'Items', type: 'stringList', itemLabel: 'Item', maxItems: 30 },
    { key: 'separator', label: 'Separator', type: 'text', maxLength: 20 },
    { key: 'mode', label: 'Mode', type: 'select', options: [
      { value: 'scroll', label: 'Scroll' },
      { value: 'rotate', label: 'Rotate' },
    ] },
    { key: 'speed', label: 'Speed', type: 'number', min: 10, max: 400, step: 5, unit: 'px/s', showIf: { key: 'mode', equals: 'scroll' } },
    { key: 'direction', label: 'Direction', type: 'select', options: [
      { value: 'left', label: 'Left' },
      { value: 'right', label: 'Right' },
    ], showIf: { key: 'mode', equals: 'scroll' } },
    { key: 'rotateSeconds', label: 'Rotate every', type: 'number', min: 1, max: 120, step: 1, unit: 's', showIf: { key: 'mode', equals: 'rotate' } },
  ],
  styleCapabilities: ['font', 'text', 'background', 'border', 'radius', 'padding', 'glow', 'shadow', 'animation'],
  validate: makeValidator<TickerProps>(
    {
      items: ['Welcome to NeonStage', 'Follow for more', '!commands'],
      separator: '  ✦  ',
      speed: 60,
      direction: 'left',
      mode: 'scroll',
      rotateSeconds: 6,
    },
    {
      items: strListField(['Welcome to NeonStage', 'Follow for more', '!commands'], 30, 500),
      separator: strField('  ✦  ', 20),
      speed: numField(60, 10, 400),
      direction: enumField(['left', 'right'] as const, 'left'),
      mode: enumField(['scroll', 'rotate'] as const, 'scroll'),
      rotateSeconds: numField(6, 1, 120),
    },
  ),
  visualOverflow: () => 0,
};
