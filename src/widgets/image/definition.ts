import { z } from 'zod';
import { makeValidator, type WidgetDefinition } from '../contract';
import { enumField, strField } from '../fields';

export type ImageProps = {
  assetId: string;
  fit: 'contain' | 'cover' | 'fill';
  alt: string;
};

export const IMAGE_ASSET_ID = /^[a-f0-9]{64}\.(png|jpe?g|gif|webp|svg)$/;

const assetIdField = z.unknown().transform((value) =>
  typeof value === 'string' && (value === '' || IMAGE_ASSET_ID.test(value)) ? value : '',
);

export const imageWidget: WidgetDefinition<ImageProps> = {
  kind: 'image',
  version: 1,
  name: 'Image',
  description: 'A user image asset with a fixed fit mode.',
  category: 'media',
  icon: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6',
  defaultSize: { w: 480, h: 270 },
  minSize: { w: 24, h: 24 },
  defaultProps: () => ({ assetId: '', fit: 'contain', alt: '' }),
  fields: [
    { key: 'assetId', label: 'Image', type: 'asset', accept: 'image' },
    { key: 'fit', label: 'Fit', type: 'select', options: [
      { value: 'contain', label: 'Contain' },
      { value: 'cover', label: 'Cover' },
      { value: 'fill', label: 'Fill' },
    ] },
    { key: 'alt', label: 'Alt text', type: 'text', maxLength: 200 },
  ],
  styleCapabilities: ['radius', 'border', 'shadow', 'glow', 'background'],
  validate: makeValidator<ImageProps>(
    { assetId: '', fit: 'contain', alt: '' },
    {
      assetId: assetIdField,
      fit: enumField(['contain', 'cover', 'fill'] as const, 'contain'),
      alt: strField('', 200),
    },
  ),
  notes: ['The image is served from the managed asset store by content id only.'],
};
