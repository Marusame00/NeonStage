import { makeValidator, type WidgetDefinition } from '../contract';
import { boolField, enumField, strField } from '../fields';

export type ClockProps = {
  mode: 'local-time' | 'session-elapsed';
  hour12: boolean;
  showSeconds: boolean;
  label: string;
  showLabel: boolean;
};

export const clockWidget: WidgetDefinition<ClockProps> = {
  kind: 'clock',
  version: 1,
  name: 'Clock',
  description: 'Local time or elapsed session clock.',
  category: 'time',
  icon: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8v4l3 2',
  defaultSize: { w: 360, h: 96 },
  minSize: { w: 60, h: 32 },
  defaultProps: () => ({
    mode: 'local-time',
    hour12: false,
    showSeconds: true,
    label: 'Clock',
    showLabel: false,
  }),
  fields: [
    { key: 'mode', label: 'Mode', type: 'select', options: [
      { value: 'local-time', label: 'Local time' },
      { value: 'session-elapsed', label: 'Session elapsed' },
    ] },
    { key: 'hour12', label: '12-hour clock', type: 'boolean', showIf: { key: 'mode', equals: 'local-time' } },
    { key: 'showSeconds', label: 'Show seconds', type: 'boolean' },
    { key: 'label', label: 'Label', type: 'text', maxLength: 60 },
    { key: 'showLabel', label: 'Show label', type: 'boolean' },
  ],
  styleCapabilities: ['font', 'text', 'background', 'border', 'radius', 'padding', 'glow', 'shadow'],
  validate: makeValidator<ClockProps>(
    { mode: 'local-time', hour12: false, showSeconds: true, label: 'Clock', showLabel: false },
    {
      mode: enumField(['local-time', 'session-elapsed'] as const, 'local-time'),
      hour12: boolField(false),
      showSeconds: boolField(true),
      label: strField('Clock', 60),
      showLabel: boolField(false),
    },
  ),
};
