import { makeValidator, type WidgetDefinition } from '../contract';
import { boolField, enumField, numField, strField } from '../fields';

export type TimerProps = {
  mode: 'countdown' | 'elapsed';
  durationMs: number;
  format: 'auto' | 'hh:mm:ss' | 'mm:ss';
  label: string;
  showLabel: boolean;
  endText: string;
};

export const timerWidget: WidgetDefinition<TimerProps> = {
  kind: 'timer',
  version: 1,
  name: 'Timer',
  description: 'Countdown or elapsed timer driven by shared runtime state.',
  category: 'time',
  icon: 'M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  defaultSize: { w: 420, h: 120 },
  minSize: { w: 80, h: 40 },
  defaultProps: () => ({
    mode: 'countdown',
    durationMs: 600_000,
    format: 'auto',
    label: 'Timer',
    showLabel: true,
    endText: 'Starting soon!',
  }),
  fields: [
    { key: 'mode', label: 'Mode', type: 'select', options: [
      { value: 'countdown', label: 'Countdown' },
      { value: 'elapsed', label: 'Elapsed' },
    ] },
    { key: 'durationMs', label: 'Duration', type: 'duration', showIf: { key: 'mode', equals: 'countdown' } },
    { key: 'format', label: 'Format', type: 'select', options: [
      { value: 'auto', label: 'Auto' },
      { value: 'hh:mm:ss', label: 'hh:mm:ss' },
      { value: 'mm:ss', label: 'mm:ss' },
    ] },
    { key: 'label', label: 'Label', type: 'text', maxLength: 60 },
    { key: 'showLabel', label: 'Show label', type: 'boolean' },
    { key: 'endText', label: 'End text', type: 'text', maxLength: 120, showIf: { key: 'mode', equals: 'countdown' } },
  ],
  styleCapabilities: ['font', 'text', 'background', 'border', 'radius', 'padding', 'glow', 'shadow'],
  validate: makeValidator<TimerProps>(
    { mode: 'countdown', durationMs: 600_000, format: 'auto', label: 'Timer', showLabel: true, endText: 'Starting soon!' },
    {
      mode: enumField(['countdown', 'elapsed'] as const, 'countdown'),
      durationMs: numField(600_000, 0, 86_400_000),
      format: enumField(['auto', 'hh:mm:ss', 'mm:ss'] as const, 'auto'),
      label: strField('Timer', 60),
      showLabel: boolField(true),
      endText: strField('Starting soon!', 120),
    },
  ),
  runtime: 'timer',
};
