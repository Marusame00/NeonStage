import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import type { Scene } from '../../../shared/model';

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const HANDLES: { handle: ResizeHandle; left: string; top: string; cursor: string }[] = [
  { handle: 'nw', left: '0%', top: '0%', cursor: 'nwse-resize' },
  { handle: 'n', left: '50%', top: '0%', cursor: 'ns-resize' },
  { handle: 'ne', left: '100%', top: '0%', cursor: 'nesw-resize' },
  { handle: 'e', left: '100%', top: '50%', cursor: 'ew-resize' },
  { handle: 'se', left: '100%', top: '100%', cursor: 'nwse-resize' },
  { handle: 's', left: '50%', top: '100%', cursor: 'ns-resize' },
  { handle: 'sw', left: '0%', top: '100%', cursor: 'nesw-resize' },
  { handle: 'w', left: '0%', top: '50%', cursor: 'ew-resize' },
];

export interface SelectionLayerProps {
  scene: Scene;
  selection: string[];
  hovered: string | null;
  zoom: number;
  onHandlePointerDown(handle: ResizeHandle, event: ReactPointerEvent<HTMLDivElement>): void;
}

export function SelectionLayer({
  scene,
  selection,
  hovered,
  zoom,
  onHandlePointerDown,
}: SelectionLayerProps): ReactNode {
  const line = 1 / zoom;
  const handleSize = 8 / zoom;
  const selected = selection
    .map((id) => scene.nodes[id])
    .filter((node): node is NonNullable<typeof node> => node !== undefined);
  const single = selected.length === 1 ? selected[0]! : null;
  const hoverNode = hovered && !selection.includes(hovered) ? scene.nodes[hovered] : undefined;

  return (
    <div className="ns-selection-layer">
      {hoverNode ? (
        <div
          className="ns-outline is-hover"
          style={{
            left: hoverNode.x,
            top: hoverNode.y,
            width: hoverNode.w,
            height: hoverNode.h,
            borderWidth: line,
          }}
        />
      ) : null}
      {selected.map((node) => (
        <div
          key={node.id}
          className={['ns-outline', node.type === 'group' ? 'is-group' : ''].filter(Boolean).join(' ')}
          style={{
            left: node.x,
            top: node.y,
            width: node.w,
            height: node.h,
            borderWidth: line,
          }}
        />
      ))}
      {single && !single.locked
        ? HANDLES.map((entry) => (
            <div
              key={entry.handle}
              className="ns-handle"
              style={{
                left: `calc(${entry.left} + ${single.x}px)`,
                top: `calc(${entry.top} + ${single.y}px)`,
                width: handleSize,
                height: handleSize,
                margin: `${-handleSize / 2}px 0 0 ${-handleSize / 2}px`,
                cursor: entry.cursor,
              }}
              onPointerDown={(event) => onHandlePointerDown(entry.handle, event)}
            />
          ))
        : null}
    </div>
  );
}
