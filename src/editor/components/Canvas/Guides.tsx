import type { ReactNode } from 'react';
import type { SnapGuide } from '../../../shared/snap';

export interface GuidesProps {
  guides: SnapGuide[];
  width: number;
  height: number;
}

export function Guides({ guides, width, height }: GuidesProps): ReactNode {
  if (guides.length === 0) return null;
  return (
    <>
      {guides.map((guide) => (
        <div
          key={`${guide.axis}-${guide.pos}`}
          className="ns-guide"
          style={
            guide.axis === 'x'
              ? { left: guide.pos, top: 0, width: 1, height }
              : { left: 0, top: guide.pos, width, height: 1 }
          }
        />
      ))}
    </>
  );
}
