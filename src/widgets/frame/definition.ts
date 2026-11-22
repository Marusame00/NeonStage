import { makeValidator, type WidgetDefinition } from '../contract';
import { boolField, colorField, enumField, numField, strField } from '../fields';

export type FrameProps = {
  purpose: 'game' | 'webcam';
  style: 'neon' | 'minimal' | 'brackets' | 'double' | 'rounded';
  strokeColor: string;
  strokeColor2: string;
  strokeWidth: number;
  cornerSize: number;
  label: string;
  showLabel: boolean;
  showPlaceholder: boolean;
  aspectLock: '16:9' | '4:3' | '1:1' | 'free';
};

export const frameWidget: WidgetDefinition<FrameProps> = {
  kind: 'frame',
  version: 1,
  name: 'Frame',
  description: 'Transparent capture frame for a game or webcam source.',
  category: 'frame',
  icon: 'M3 7V4h4M17 4h4v3M21 17v3h-4M7 20H3v-3',
  defaultSize: { w: 960, h: 540 },
  minSize: { w: 80, h: 45 },
  defaultProps: () => ({
    purpose: 'game',
    style: 'neon',
    strokeColor: '#ff3fd2',
    strokeColor2: '#3ff2ff',
    strokeWidth: 4,
    cornerSize: 28,
    label: 'GAME',
    showLabel: true,
    showPlaceholder: true,
    aspectLock: '16:9',
  }),
  fields: [
    { key: 'purpose', label: 'Purpose', type: 'select', options: [
      { value: 'game', label: 'Game capture' },
      { value: 'webcam', label: 'Webcam' },
    ] },
    { key: 'style', label: 'Frame style', type: 'select', options: [
      { value: 'neon', label: 'Neon' },
      { value: 'minimal', label: 'Minimal' },
      { value: 'brackets', label: 'Brackets' },
      { value: 'double', label: 'Double' },
      { value: 'rounded', label: 'Rounded' },
    ] },
    { key: 'aspectLock', label: 'Aspect lock', type: 'select', options: [
      { value: '16:9', label: '16:9' },
      { value: '4:3', label: '4:3' },
      { value: '1:1', label: '1:1' },
      { value: 'free', label: 'Free' },
    ] },
    { key: 'strokeColor', label: 'Stroke', type: 'color', section: 'Stroke' },
    { key: 'strokeColor2', label: 'Accent', type: 'color', section: 'Stroke' },
    { key: 'strokeWidth', label: 'Stroke width', type: 'number', min: 0, max: 24, step: 1, unit: 'px', section: 'Stroke' },
    { key: 'cornerSize', label: 'Corner size', type: 'number', min: 0, max: 120, step: 1, unit: 'px', section: 'Stroke' },
    { key: 'label', label: 'Label', type: 'text', maxLength: 40, section: 'Label' },
    { key: 'showLabel', label: 'Show label', type: 'boolean', section: 'Label' },
    { key: 'showPlaceholder', label: 'Show editor placeholder', type: 'boolean', section: 'Label' },
  ],
  styleCapabilities: ['border', 'radius', 'glow', 'shadow'],
  validate: makeValidator<FrameProps>(
    {
      purpose: 'game',
      style: 'neon',
      strokeColor: '#ff3fd2',
      strokeColor2: '#3ff2ff',
      strokeWidth: 4,
      cornerSize: 28,
      label: 'GAME',
      showLabel: true,
      showPlaceholder: true,
      aspectLock: '16:9',
    },
    {
      purpose: enumField(['game', 'webcam'] as const, 'game'),
      style: enumField(['neon', 'minimal', 'brackets', 'double', 'rounded'] as const, 'neon'),
      strokeColor: colorField('#ff3fd2'),
      strokeColor2: colorField('#3ff2ff'),
      strokeWidth: numField(4, 0, 24),
      cornerSize: numField(28, 0, 120),
      label: strField('GAME', 40),
      showLabel: boolField(true),
      showPlaceholder: boolField(true),
      aspectLock: enumField(['16:9', '4:3', '1:1', 'free'] as const, '16:9'),
    },
  ),
  visualOverflow: (props) => Math.max(0, props.strokeWidth),
  notes: [
    'Transparent interior: place OBS Game/Video Capture underneath. The placeholder is shown in the editor only.',
  ],
};
