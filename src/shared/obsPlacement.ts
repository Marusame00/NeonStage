export interface ObsPlacementInput {
  rect: { x: number; y: number; w: number; h: number };
  sceneWidth: number;
  sceneHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  inset: number;
}

export interface ObsPlacement {
  x: number;
  y: number;
  w: number;
  h: number;
  scale: number;
  offsetX: number;
  offsetY: number;
  aspectMismatch: boolean;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function computeObsPlacement(input: ObsPlacementInput): ObsPlacement {
  const { sceneWidth, sceneHeight, canvasWidth, canvasHeight } = input;
  const positive =
    sceneWidth > 0 && sceneHeight > 0 && canvasWidth > 0 && canvasHeight > 0;
  const scale = positive ? Math.min(canvasWidth / sceneWidth, canvasHeight / sceneHeight) : 1;
  const offsetX = (canvasWidth - sceneWidth * scale) / 2;
  const offsetY = (canvasHeight - sceneHeight * scale) / 2;
  const inset = Math.max(0, input.inset);
  const innerX = input.rect.x + inset;
  const innerY = input.rect.y + inset;
  const innerW = Math.max(1, input.rect.w - inset * 2);
  const innerH = Math.max(1, input.rect.h - inset * 2);
  return {
    x: round2(offsetX + innerX * scale),
    y: round2(offsetY + innerY * scale),
    w: round2(innerW * scale),
    h: round2(innerH * scale),
    scale: round2(scale),
    offsetX: round2(offsetX),
    offsetY: round2(offsetY),
    aspectMismatch: positive && Math.abs(sceneWidth / sceneHeight - canvasWidth / canvasHeight) > 0.001,
  };
}

export function formatObsNumber(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const rounded = round2(n);
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

export type ObsAlignment =
  | 'top-left'
  | 'top'
  | 'top-right'
  | 'left'
  | 'center'
  | 'right'
  | 'bottom-left'
  | 'bottom'
  | 'bottom-right';

export const OBS_ALIGNMENTS: { value: ObsAlignment; label: string; fx: number; fy: number }[] = [
  { value: 'top-left', label: 'Top Left', fx: 0, fy: 0 },
  { value: 'top', label: 'Top', fx: 0.5, fy: 0 },
  { value: 'top-right', label: 'Top Right', fx: 1, fy: 0 },
  { value: 'left', label: 'Left', fx: 0, fy: 0.5 },
  { value: 'center', label: 'Center', fx: 0.5, fy: 0.5 },
  { value: 'right', label: 'Right', fx: 1, fy: 0.5 },
  { value: 'bottom-left', label: 'Bottom Left', fx: 0, fy: 1 },
  { value: 'bottom', label: 'Bottom', fx: 0.5, fy: 1 },
  { value: 'bottom-right', label: 'Bottom Right', fx: 1, fy: 1 },
];

export function isObsAlignment(value: unknown): value is ObsAlignment {
  return OBS_ALIGNMENTS.some((entry) => entry.value === value);
}

function alignmentEntry(alignment: ObsAlignment): (typeof OBS_ALIGNMENTS)[number] {
  return OBS_ALIGNMENTS.find((entry) => entry.value === alignment) ?? OBS_ALIGNMENTS[0]!;
}

export function alignedObsPosition(
  placement: ObsPlacement,
  alignment: ObsAlignment,
): { x: number; y: number } {
  const entry = alignmentEntry(alignment);
  return {
    x: round2(placement.x + placement.w * entry.fx),
    y: round2(placement.y + placement.h * entry.fy),
  };
}

export function formatObsPlacementText(
  name: string,
  placement: ObsPlacement,
  alignment: ObsAlignment = 'top-left',
): string {
  const position = alignedObsPosition(placement, alignment);
  return [
    `OBS transform for "${name}"`,
    `Position: X ${formatObsNumber(position.x)}, Y ${formatObsNumber(position.y)}`,
    'Rotation: 0.00',
    `Positional Alignment: ${alignmentEntry(alignment).label}`,
    'Bounding Box Type: Stretch to bounds',
    'Alignment in Bounding Box: Center',
    `Size / Bounding Box Size: ${formatObsNumber(placement.w)} x ${formatObsNumber(placement.h)}`,
    'Crop: Left 0, Right 0, Top 0, Bottom 0',
  ].join('\n');
}
