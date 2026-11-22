import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { ProjectDoc, Scene, SceneNode } from '../../../shared/model';
import { updateWidgetProps } from '../../../shared/ops';
import { getWidget } from '../../../widgets/registry';
import { beginDrag, dragDoc, endDrag } from '../../state/actions';
import { store } from '../../state/store';

const CHAT_KINDS = ['chat-twitch', 'chat-youtube', 'chat-combined'];
const MIN_AREA = 40;

type AreaHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const HANDLES: { handle: AreaHandle; left: string; top: string; cursor: string }[] = [
  { handle: 'nw', left: '0%', top: '0%', cursor: 'nwse-resize' },
  { handle: 'n', left: '50%', top: '0%', cursor: 'ns-resize' },
  { handle: 'ne', left: '100%', top: '0%', cursor: 'nesw-resize' },
  { handle: 'e', left: '100%', top: '50%', cursor: 'ew-resize' },
  { handle: 'se', left: '100%', top: '100%', cursor: 'nwse-resize' },
  { handle: 's', left: '50%', top: '100%', cursor: 'ns-resize' },
  { handle: 'sw', left: '0%', top: '100%', cursor: 'nesw-resize' },
  { handle: 'w', left: '0%', top: '50%', cursor: 'ew-resize' },
];

interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface DragState {
  startX: number;
  startY: number;
  base: ProjectDoc;
  insets: Insets;
  handle: AreaHandle | null;
}

export interface MessageAreaLayerProps {
  scene: Scene;
  selection: string[];
  zoom: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(min, value), Math.max(min, max));
}

function withScene(doc: ProjectDoc, sceneId: string, next: Scene): ProjectDoc {
  return {
    ...doc,
    scenes: doc.scenes.map((entry) => (entry.id === sceneId ? next : entry)),
    updatedAt: new Date().toISOString(),
  };
}

function baseInset(node: SceneNode): number {
  const definition = node.widget ? getWidget(node.widget.kind) : undefined;
  const caps = definition?.styleCapabilities ?? [];
  return (
    (caps.includes('padding') ? node.style.padding : 0) +
    (caps.includes('border') && node.style.borderWidth > 0 ? node.style.borderWidth : 0)
  );
}

function insetsOf(node: SceneNode): Insets {
  const props = node.widget?.props ?? {};
  const read = (key: string): number => {
    const value = props[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  };
  return {
    top: read('areaTop'),
    right: read('areaRight'),
    bottom: read('areaBottom'),
    left: read('areaLeft'),
  };
}

function nextInsets(
  insets: Insets,
  handle: AreaHandle | null,
  dx: number,
  dy: number,
  boxW: number,
  boxH: number,
): Insets {
  if (handle === null) {
    const shiftX = clamp(dx, -insets.left, insets.right);
    const shiftY = clamp(dy, -insets.top, insets.bottom);
    return {
      top: Math.round(insets.top + shiftY),
      right: Math.round(insets.right - shiftX),
      bottom: Math.round(insets.bottom - shiftY),
      left: Math.round(insets.left + shiftX),
    };
  }
  let { top, right, bottom, left } = insets;
  if (handle.includes('w')) left = clamp(left + dx, 0, boxW - right - MIN_AREA);
  if (handle.includes('e')) right = clamp(right - dx, 0, boxW - left - MIN_AREA);
  if (handle.includes('n')) top = clamp(top + dy, 0, boxH - bottom - MIN_AREA);
  if (handle.includes('s')) bottom = clamp(bottom - dy, 0, boxH - top - MIN_AREA);
  return {
    top: Math.round(top),
    right: Math.round(right),
    bottom: Math.round(bottom),
    left: Math.round(left),
  };
}

export function MessageAreaLayer({ scene, selection, zoom }: MessageAreaLayerProps): ReactNode {
  const drag = useRef<DragState | null>(null);
  const id = selection.length === 1 ? selection[0]! : null;
  const node = id ? scene.nodes[id] : undefined;
  if (!node || node.locked || !node.widget || !CHAT_KINDS.includes(node.widget.kind)) return null;

  const base = baseInset(node);
  const insets = insetsOf(node);
  const boxW = Math.max(0, node.w - 2 * base);
  const boxH = Math.max(0, node.h - 2 * base);
  const left = node.x + base + insets.left;
  const top = node.y + base + insets.top;
  const width = Math.max(0, boxW - insets.left - insets.right);
  const height = Math.max(0, boxH - insets.top - insets.bottom);
  const line = 1 / zoom;
  const handleSize = 7 / zoom;

  const start = (handle: AreaHandle | null, event: ReactPointerEvent<HTMLDivElement>): void => {
    event.stopPropagation();
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    beginDrag();
    drag.current = {
      startX: event.clientX,
      startY: event.clientY,
      base: store.getState().doc,
      insets,
      handle,
    };
  };

  const move = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const active = drag.current;
    if (!active) return;
    const dx = (event.clientX - active.startX) / zoom;
    const dy = (event.clientY - active.startY) / zoom;
    const next = nextInsets(active.insets, active.handle, dx, dy, boxW, boxH);
    const baseScene = active.base.scenes.find((entry) => entry.id === scene.id) ?? scene;
    dragDoc(
      withScene(
        active.base,
        scene.id,
        updateWidgetProps(baseScene, node.id, {
          areaTop: next.top,
          areaRight: next.right,
          areaBottom: next.bottom,
          areaLeft: next.left,
        }),
      ),
    );
  };

  const finish = (): void => {
    if (!drag.current) return;
    drag.current = null;
    endDrag();
  };

  return (
    <div className="ns-msgarea-layer">
      <div
        className="ns-msgarea-box"
        style={{ left, top, width, height, borderWidth: line }}
      />
      <div
        className="ns-msgarea-grip"
        style={{
          left,
          top,
          fontSize: 11 / zoom,
          padding: `${2 / zoom}px ${5 / zoom}px`,
        }}
        onPointerDown={(event) => start(null, event)}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={finish}
      >
        Messages
      </div>
      {HANDLES.map((entry) => (
        <div
          key={entry.handle}
          className="ns-msgarea-handle"
          style={{
            left: `calc(${entry.left} + ${left}px)`,
            top: `calc(${entry.top} + ${top}px)`,
            width: handleSize,
            height: handleSize,
            margin: `${-handleSize / 2}px 0 0 ${-handleSize / 2}px`,
            cursor: entry.cursor,
          }}
          onPointerDown={(event) => start(entry.handle, event)}
          onPointerMove={move}
          onPointerUp={finish}
          onPointerCancel={finish}
        />
      ))}
    </div>
  );
}
