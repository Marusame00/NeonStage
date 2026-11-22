import type { Rect } from './geometry';

export interface SnapGuide {
  axis: 'x' | 'y';
  pos: number;
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: SnapGuide[];
}

function bestDelta(lines: number[], targets: number[], threshold: number): number {
  let best = 0;
  let bestDistance = Infinity;
  for (const line of lines) {
    for (const target of targets) {
      const delta = target - line;
      const distance = Math.abs(delta);
      if (distance <= threshold && distance < bestDistance) {
        bestDistance = distance;
        best = delta;
      }
    }
  }
  return best;
}

function collectGuides(axis: 'x' | 'y', lines: number[], targets: number[], delta: number): SnapGuide[] {
  const guides: SnapGuide[] = [];
  for (const line of lines) {
    for (const target of targets) {
      if (Math.abs(line + delta - target) < 0.5 && !guides.some((guide) => guide.pos === target)) {
        guides.push({ axis, pos: target });
      }
    }
  }
  return guides;
}

export function computeSnap(
  moving: Rect,
  others: Rect[],
  canvas: { w: number; h: number },
  threshold: number,
): SnapResult {
  const xLines = [moving.x, moving.x + moving.w / 2, moving.x + moving.w];
  const yLines = [moving.y, moving.y + moving.h / 2, moving.y + moving.h];

  const xTargets = [0, canvas.w / 2, canvas.w];
  const yTargets = [0, canvas.h / 2, canvas.h];
  for (const rect of others) {
    xTargets.push(rect.x, rect.x + rect.w / 2, rect.x + rect.w);
    yTargets.push(rect.y, rect.y + rect.h / 2, rect.y + rect.h);
  }

  const dx = bestDelta(xLines, xTargets, threshold);
  const dy = bestDelta(yLines, yTargets, threshold);

  return {
    dx,
    dy,
    guides: [...collectGuides('x', xLines, xTargets, dx), ...collectGuides('y', yLines, yTargets, dy)],
  };
}

export function snapToGrid(value: number, grid: number): number {
  if (!Number.isFinite(grid) || grid <= 0) return value;
  return Math.round(value / grid) * grid;
}
