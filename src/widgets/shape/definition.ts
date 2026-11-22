import { makeValidator, type WidgetDefinition } from '../contract';
import { boolField, colorField, enumField, numField } from '../fields';

export type ShapeKind = 'rect' | 'ellipse' | 'line' | 'divider' | 'chevrons' | 'corner-brackets' | 'grid' | 'sun';

export type ShapeProps = {
  shape: ShapeKind;
  fillColor: string;
  fillOpacity: number;
  fill2Color: string;
  gradient: boolean;
  angle: number;
  strokeColor: string;
  strokeOpacity: number;
  strokeWidth: number;
  dash: boolean;
};

export const SHAPE_KINDS: ShapeKind[] = [
  'rect',
  'ellipse',
  'line',
  'divider',
  'chevrons',
  'corner-brackets',
  'grid',
  'sun',
];

export const shapeWidget: WidgetDefinition<ShapeProps> = {
  kind: 'shape',
  version: 1,
  name: 'Shape',
  description: 'Decorative vector shapes drawn as inline SVG.',
  category: 'shape',
  icon: 'M3 5h18v14H3z',
  defaultSize: { w: 320, h: 180 },
  minSize: { w: 8, h: 8 },
  defaultProps: () => ({
    shape: 'rect',
    fillColor: '#ff3fd2',
    fillOpacity: 1,
    fill2Color: '#2a0f4a',
    gradient: false,
    angle: 135,
    strokeColor: '#ff3fd2',
    strokeOpacity: 1,
    strokeWidth: 0,
    dash: false,
  }),
  fields: [
    { key: 'shape', label: 'Shape', type: 'select', options: SHAPE_KINDS.map((value) => ({ value, label: value })) },
    { key: 'fillColor', label: 'Fill', type: 'color', section: 'Fill' },
    { key: 'fillOpacity', label: 'Fill opacity', type: 'number', min: 0, max: 1, step: 0.05, section: 'Fill' },
    { key: 'gradient', label: 'Gradient fill', type: 'boolean', section: 'Fill' },
    { key: 'fill2Color', label: 'Gradient color', type: 'color', section: 'Fill', showIf: { key: 'gradient', equals: true } },
    { key: 'angle', label: 'Gradient angle', type: 'number', min: 0, max: 360, step: 1, unit: 'deg', section: 'Fill', showIf: { key: 'gradient', equals: true } },
    { key: 'strokeColor', label: 'Stroke', type: 'color', section: 'Stroke' },
    { key: 'strokeOpacity', label: 'Stroke opacity', type: 'number', min: 0, max: 1, step: 0.05, section: 'Stroke' },
    { key: 'strokeWidth', label: 'Stroke width', type: 'number', min: 0, max: 40, step: 1, unit: 'px', section: 'Stroke' },
    { key: 'dash', label: 'Dashed stroke', type: 'boolean', section: 'Stroke' },
  ],
  styleCapabilities: ['radius', 'glow', 'shadow', 'animation'],
  validate: makeValidator<ShapeProps>(
    {
      shape: 'rect',
      fillColor: '#ff3fd2',
      fillOpacity: 1,
      fill2Color: '#2a0f4a',
      gradient: false,
      angle: 135,
      strokeColor: '#ff3fd2',
      strokeOpacity: 1,
      strokeWidth: 0,
      dash: false,
    },
    {
      shape: enumField(SHAPE_KINDS, 'rect'),
      fillColor: colorField('#ff3fd2'),
      fillOpacity: numField(1, 0, 1),
      fill2Color: colorField('#2a0f4a'),
      gradient: boolField(false),
      angle: numField(135, 0, 360),
      strokeColor: colorField('#ff3fd2'),
      strokeOpacity: numField(1, 0, 1),
      strokeWidth: numField(0, 0, 40),
      dash: boolField(false),
    },
  ),
};
