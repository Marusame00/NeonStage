import type { ReactNode } from 'react';
import type { Rect } from '../../../shared/geometry';

export interface MarqueeProps {
  rect: Rect | null;
}

export function Marquee({ rect }: MarqueeProps): ReactNode {
  if (!rect) return null;
  return (
    <div
      className="ns-marquee"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
    />
  );
}
