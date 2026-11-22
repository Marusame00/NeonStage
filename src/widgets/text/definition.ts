import { makeValidator, type WidgetDefinition } from '../contract';
import { boolField, enumField, strField } from '../fields';

export type TextProps = {
  text: string;
  verticalAlign: 'top' | 'middle' | 'bottom';
  wrap: boolean;
  uppercase: boolean;
};

export const textWidget: WidgetDefinition<TextProps> = {
  kind: 'text',
  version: 1,
  name: 'Text',
  description: 'A styled text block with optional wrapping.',
  category: 'text',
  icon: 'M4 6h16M4 12h10M4 18h13',
  defaultSize: { w: 480, h: 96 },
  minSize: { w: 40, h: 24 },
  defaultProps: () => ({ text: 'NeonStage', verticalAlign: 'top', wrap: true, uppercase: false }),
  fields: [
    { key: 'text', label: 'Text', type: 'textarea', maxLength: 2000 },
    { key: 'verticalAlign', label: 'Vertical align', type: 'select', options: [
      { value: 'top', label: 'Top' },
      { value: 'middle', label: 'Middle' },
      { value: 'bottom', label: 'Bottom' },
    ] },
    { key: 'wrap', label: 'Wrap lines', type: 'boolean' },
    { key: 'uppercase', label: 'Uppercase', type: 'boolean' },
  ],
  styleCapabilities: ['font', 'text', 'background', 'border', 'radius', 'padding', 'glow', 'shadow'],
  validate: makeValidator<TextProps>(
    { text: 'NeonStage', verticalAlign: 'top', wrap: true, uppercase: false },
    {
      text: strField('NeonStage', 2000),
      verticalAlign: enumField(['top', 'middle', 'bottom'] as const, 'top'),
      wrap: boolField(true),
      uppercase: boolField(false),
    },
  ),
};
