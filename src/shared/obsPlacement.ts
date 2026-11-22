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

export function formatObsPlacementText(name: string, placement: ObsPlacement): string {
  return [
    `OBS transform for "${name}"`,
    `Position: X ${formatObsNumber(placement.x)}, Y ${formatObsNumber(placement.y)}`,
    'Rotation: 0.00',
    'Positional Alignment: Top Left',
    'Bounding Box Type: Stretch to bounds',
    'Alignment in Bounding Box: Center',
    `Bounding Box Size: ${formatObsNumber(placement.w)} x ${formatObsNumber(placement.h)}`,
    'Crop: Left 0, Right 0, Top 0, Bottom 0',
  ].join('\n');
}
