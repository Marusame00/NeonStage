import { makeValidator, type WidgetDefinition } from '../contract';
import { boolField, colorField, numField, strField } from '../fields';

export type GoalProps = {
  title: string;
  target: number;
  startValue: number;
  unit: string;
  showNumbers: boolean;
  showPercent: boolean;
  barColor: string;
  barColor2: string;
  trackColor: string;
  trackOpacity: number;
  barHeight: number;
};

export const goalWidget: WidgetDefinition<GoalProps> = {
  kind: 'goal',
  version: 1,
  name: 'Goal',
  description: 'Manually controlled progress bar.',
  category: 'progress',
  icon: 'M4 12h16M4 9v6M20 9v6',
  defaultSize: { w: 480, h: 120 },
  minSize: { w: 120, h: 40 },
  defaultProps: () => ({
    title: 'Goal',
    target: 100,
    startValue: 0,
    unit: 'followers',
    showNumbers: true,
    showPercent: true,
    barColor: '#ff3fd2',
    barColor2: '#3ff2ff',
    trackColor: '#120a24',
    trackOpacity: 0.6,
    barHeight: 18,
  }),
  fields: [
    { key: 'title', label: 'Title', type: 'text', maxLength: 80 },
    { key: 'target', label: 'Target', type: 'number', min: 1, max: 1_000_000, step: 1 },
    { key: 'startValue', label: 'Start value', type: 'number', min: 0, max: 1_000_000, step: 1 },
    { key: 'unit', label: 'Unit', type: 'text', maxLength: 40 },
    { key: 'showNumbers', label: 'Show numbers', type: 'boolean' },
    { key: 'showPercent', label: 'Show percent', type: 'boolean' },
    { key: 'barColor', label: 'Bar color', type: 'color', section: 'Bar' },
    { key: 'barColor2', label: 'Bar gradient color', type: 'color', section: 'Bar' },
    { key: 'trackColor', label: 'Track color', type: 'color', section: 'Bar' },
    { key: 'trackOpacity', label: 'Track opacity', type: 'number', min: 0, max: 1, step: 0.05, section: 'Bar' },
    { key: 'barHeight', label: 'Bar height', type: 'number', min: 2, max: 80, step: 1, unit: 'px', section: 'Bar' },
  ],
  styleCapabilities: ['font', 'text', 'background', 'border', 'radius', 'padding', 'glow', 'shadow'],
  validate: makeValidator<GoalProps>(
    {
      title: 'Goal',
      target: 100,
      startValue: 0,
      unit: 'followers',
      showNumbers: true,
      showPercent: true,
      barColor: '#ff3fd2',
      barColor2: '#3ff2ff',
      trackColor: '#120a24',
      trackOpacity: 0.6,
      barHeight: 18,
    },
    {
      title: strField('Goal', 80),
      target: numField(100, 1, 1_000_000),
      startValue: numField(0, 0, 1_000_000),
      unit: strField('followers', 40),
      showNumbers: boolField(true),
      showPercent: boolField(true),
      barColor: colorField('#ff3fd2'),
      barColor2: colorField('#3ff2ff'),
      trackColor: colorField('#120a24'),
      trackOpacity: numField(0.6, 0, 1),
      barHeight: numField(18, 2, 80),
    },
  ),
  runtime: 'goal',
  manualLabel: true,
  notes: [
    'Manually controlled — update the value from the Controls panel. Not connected to donations, subs or followers.',
  ],
};
