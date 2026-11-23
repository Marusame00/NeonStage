import { describe, expect, it } from 'vitest';
import {
  alignedObsPosition,
  computeObsPlacement,
  formatObsNumber,
  formatObsPlacementText,
} from '../src/shared/obsPlacement';

describe('computeObsPlacement', () => {
  it('keeps scene values when the canvas matches the scene', () => {
    const placement = computeObsPlacement({
      rect: { x: 480, y: 270, w: 960, h: 540 },
      sceneWidth: 1920,
      sceneHeight: 1080,
      canvasWidth: 1920,
      canvasHeight: 1080,
      inset: 0,
    });
    expect(placement).toEqual({
      x: 480,
      y: 270,
      w: 960,
      h: 540,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      aspectMismatch: false,
    });
  });

  it('scales by two thirds for a 1280x720 canvas', () => {
    const placement = computeObsPlacement({
      rect: { x: 480, y: 270, w: 960, h: 540 },
      sceneWidth: 1920,
      sceneHeight: 1080,
      canvasWidth: 1280,
      canvasHeight: 720,
      inset: 0,
    });
    expect(placement.x).toBe(320);
    expect(placement.y).toBe(180);
    expect(placement.w).toBe(640);
    expect(placement.h).toBe(360);
    expect(placement.scale).toBe(0.67);
  });

  it('shrinks the rect by the inset on every side', () => {
    const placement = computeObsPlacement({
      rect: { x: 480, y: 270, w: 960, h: 540 },
      sceneWidth: 1920,
      sceneHeight: 1080,
      canvasWidth: 1920,
      canvasHeight: 1080,
      inset: 4,
    });
    expect(placement.x).toBe(484);
    expect(placement.y).toBe(274);
    expect(placement.w).toBe(952);
    expect(placement.h).toBe(532);
  });

  it('clamps the inset rect to at least one pixel', () => {
    const placement = computeObsPlacement({
      rect: { x: 0, y: 0, w: 10, h: 10 },
      sceneWidth: 1920,
      sceneHeight: 1080,
      canvasWidth: 1920,
      canvasHeight: 1080,
      inset: 40,
    });
    expect(placement.w).toBe(1);
    expect(placement.h).toBe(1);
  });

  it('adds the letterbox offset for a mismatched canvas', () => {
    const placement = computeObsPlacement({
      rect: { x: 0, y: 0, w: 1920, h: 1080 },
      sceneWidth: 1920,
      sceneHeight: 1080,
      canvasWidth: 1080,
      canvasHeight: 1080,
      inset: 0,
    });
    expect(placement.aspectMismatch).toBe(true);
    expect(placement.scale).toBe(0.56);
    expect(placement.offsetX).toBe(0);
    expect(placement.offsetY).toBe(236.25);
    expect(placement.y).toBe(236.25);
    expect(placement.h).toBe(607.5);
  });

  it('falls back to scale 1 for non-positive sizes', () => {
    const placement = computeObsPlacement({
      rect: { x: 10, y: 20, w: 100, h: 50 },
      sceneWidth: 0,
      sceneHeight: 0,
      canvasWidth: 0,
      canvasHeight: 0,
      inset: 0,
    });
    expect(placement.scale).toBe(1);
    expect(placement.x).toBe(10);
    expect(placement.y).toBe(20);
    expect(placement.aspectMismatch).toBe(false);
  });
});

describe('formatObsNumber', () => {
  it('prints whole numbers without decimals', () => {
    expect(formatObsNumber(960)).toBe('960');
    expect(formatObsNumber(0)).toBe('0');
    expect(formatObsNumber(-12)).toBe('-12');
  });

  it('prints fractions with up to two decimals and no trailing zeros', () => {
    expect(formatObsNumber(320.5)).toBe('320.5');
    expect(formatObsNumber(236.25)).toBe('236.25');
    expect(formatObsNumber(1 / 3)).toBe('0.33');
    expect(formatObsNumber(1.5)).toBe('1.5');
  });
});

describe('formatObsPlacementText', () => {
  it('lists the OBS edit transform values in order', () => {
    const placement = computeObsPlacement({
      rect: { x: 480, y: 270, w: 960, h: 540 },
      sceneWidth: 1920,
      sceneHeight: 1080,
      canvasWidth: 1920,
      canvasHeight: 1080,
      inset: 0,
    });
    expect(formatObsPlacementText('GAME', placement)).toBe(
      [
        'OBS transform for "GAME"',
        'Position: X 480, Y 270',
        'Rotation: 0.00',
        'Positional Alignment: Top Left',
        'Bounding Box Type: Stretch to bounds',
        'Alignment in Bounding Box: Center',
        'Size / Bounding Box Size: 960 x 540',
        'Crop: Left 0, Right 0, Top 0, Bottom 0',
      ].join('\n'),
    );
  });

  it('uses the anchor point for a center-aligned source', () => {
    const placement = computeObsPlacement({
      rect: { x: 1305.6, y: 57.8, w: 537.6, h: 324 },
      sceneWidth: 1920,
      sceneHeight: 1080,
      canvasWidth: 1920,
      canvasHeight: 1080,
      inset: 0,
    });
    const text = formatObsPlacementText('Webcam', placement, 'center');
    expect(text).toContain('Position: X 1574.4, Y 219.8');
    expect(text).toContain('Positional Alignment: Center');
  });
});

describe('alignedObsPosition', () => {
  const placement = computeObsPlacement({
    rect: { x: 100, y: 200, w: 400, h: 300 },
    sceneWidth: 1920,
    sceneHeight: 1080,
    canvasWidth: 1920,
    canvasHeight: 1080,
    inset: 0,
  });

  it('offsets the position by the alignment anchor', () => {
    expect(alignedObsPosition(placement, 'top-left')).toEqual({ x: 100, y: 200 });
    expect(alignedObsPosition(placement, 'center')).toEqual({ x: 300, y: 350 });
    expect(alignedObsPosition(placement, 'bottom-right')).toEqual({ x: 500, y: 500 });
    expect(alignedObsPosition(placement, 'top')).toEqual({ x: 300, y: 200 });
    expect(alignedObsPosition(placement, 'left')).toEqual({ x: 100, y: 350 });
  });
});
