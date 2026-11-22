import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { rectsIntersect, unionRects, type Rect } from '../../../shared/geometry';
import type { ProjectDoc, Scene, SceneNode } from '../../../shared/model';
import {
  getAncestors,
  getRenderOrder,
  isEffectivelyLocked,
  isEffectivelyVisible,
  moveNodes,
  setNodeRect,
} from '../../../shared/ops';
import { buildOutputScene } from '../../../shared/output';
import { computeSnap, type SnapGuide } from '../../../shared/snap';
import { RenderProvider, SceneRenderer } from '../../../render';
import { getWidget } from '../../../widgets/registry';
import {
  addWidget,
  beginDrag,
  dragDoc,
  endDrag,
  fitView,
  renderStores,
  setPan,
  setSelection,
  toggleSelected,
  zoomAt,
} from '../../state/actions';
import { selectScene, store, useEditor, type EditorState } from '../../state/store';
import { WIDGET_MIME } from '../LibraryPanel';
import { Guides } from './Guides';
import { Marquee } from './Marquee';
import { SelectionLayer, type ResizeHandle } from './SelectionLayer';
import { MessageAreaLayer } from './MessageAreaLayer';
import { CanvasToolbar } from './CanvasToolbar';

const selectAll = (state: EditorState): EditorState => state;

type Interaction =
  | { kind: 'pan'; startX: number; startY: number; panX: number; panY: number }
  | { kind: 'marquee'; start: { x: number; y: number }; additive: boolean }
  | { kind: 'move'; start: { x: number; y: number }; base: ProjectDoc; ids: string[]; moved: boolean; leaf: string | null }
  | {
      kind: 'resize';
      handle: ResizeHandle;
      start: { x: number; y: number };
      base: ProjectDoc;
      id: string;
      rect: Rect;
    };

function selectedAncestorOr(scene: Scene, id: string, selection: readonly string[]): string {
  const ancestors = getAncestors(scene, id);
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    if (selection.includes(ancestors[index]!)) return ancestors[index]!;
  }
  return id;
}

function isWithin(scene: Scene, id: string, ids: readonly string[]): boolean {
  return ids.includes(id) || getAncestors(scene, id).some((ancestorId) => ids.includes(ancestorId));
}

function hitTest(scene: Scene, point: { x: number; y: number }, selection: readonly string[]): string | null {
  const order = getRenderOrder(scene);
  for (let index = order.length - 1; index >= 0; index -= 1) {
    const id = order[index]!;
    const node = scene.nodes[id];
    if (!node || node.type !== 'widget') continue;
    if (!isEffectivelyVisible(scene, id) || isEffectivelyLocked(scene, id)) continue;
    if (
      point.x >= node.x &&
      point.x <= node.x + node.w &&
      point.y >= node.y &&
      point.y <= node.y + node.h
    ) {
      return selectedAncestorOr(scene, id, selection);
    }
  }
  return null;
}

function aspectRatioOf(node: SceneNode): number | null {
  if (node.widget?.kind !== 'frame') return null;
  const lock = node.widget.props.aspectLock;
  if (lock === '16:9') return 16 / 9;
  if (lock === '4:3') return 4 / 3;
  if (lock === '1:1') return 1;
  return null;
}

function minSizeOf(node: SceneNode): { w: number; h: number } {
  const definition = node.widget ? getWidget(node.widget.kind) : undefined;
  return { w: Math.max(4, definition?.minSize?.w ?? 4), h: Math.max(4, definition?.minSize?.h ?? 4) };
}

export function CanvasView(): ReactNode {
  const state = useEditor(selectAll);
  const { doc, meta, zoom, pan, selection, outputPreview, prefs, server } = state;
  const scene = selectScene(state);
  const hostRef = useRef<HTMLDivElement>(null);
  const interaction = useRef<Interaction | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [guides, setGuides] = useState<SnapGuide[]>([]);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [panning, setPanning] = useState(false);
  const fitted = useRef(false);

  const outputScene = useMemo(
    () => buildOutputScene(doc, meta.programSceneId, { kind: 'scene', sceneId: scene.id }),
    [doc, meta.programSceneId, scene.id],
  );

  const mediaUrl = useCallback(
    (assetId: string): string =>
      server.baseUrl ? `${server.baseUrl}/media/${encodeURIComponent(assetId)}` : '',
    [server.baseUrl],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = (): void => {
      const rect = host.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      store.set({ viewport: { w: rect.width, h: rect.height } });
      if (!fitted.current) {
        fitted.current = true;
        fitView();
      }
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (observer) observer.observe(host);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  useEffect(() => {
    const down = (event: KeyboardEvent): void => {
      if (event.code === 'Space' && !event.repeat) setSpaceDown(true);
    };
    const up = (event: KeyboardEvent): void => {
      if (event.code === 'Space') setSpaceDown(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const rect = host.getBoundingClientRect();
      const cx = event.clientX - rect.left;
      const cy = event.clientY - rect.top;
      if (event.ctrlKey || event.metaKey) {
        const factor = Math.exp(-event.deltaY * 0.0015);
        zoomAt(store.getState().zoom * factor, cx, cy);
        return;
      }
      setPan(store.getState().pan.x - event.deltaX, store.getState().pan.y - event.deltaY);
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    return () => host.removeEventListener('wheel', onWheel);
  }, []);

  const toScene = useCallback((clientX: number, clientY: number): { x: number; y: number } => {
    const host = hostRef.current;
    const current = store.getState();
    if (!host) return { x: 0, y: 0 };
    const rect = host.getBoundingClientRect();
    return {
      x: (clientX - rect.left - current.pan.x) / current.zoom,
      y: (clientY - rect.top - current.pan.y) / current.zoom,
    };
  }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const focused = document.activeElement;
    if (
      focused instanceof HTMLElement &&
      (focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA' || focused.tagName === 'SELECT')
    ) {
      focused.blur();
    }
    if (event.button === 1 || spaceDown) {
      event.currentTarget.setPointerCapture(event.pointerId);
      interaction.current = {
        kind: 'pan',
        startX: event.clientX,
        startY: event.clientY,
        panX: pan.x,
        panY: pan.y,
      };
      setPanning(true);
      return;
    }
    if (event.button !== 0) return;

    const point = toScene(event.clientX, event.clientY);
    const hit = hitTest(scene, point, store.getState().selection);
    event.currentTarget.setPointerCapture(event.pointerId);

    if (hit) {
      const leaf = hitTest(scene, point, []);
      if (event.shiftKey || event.ctrlKey || event.metaKey) {
        toggleSelected(leaf ?? hit);
        return;
      }
      const current = store.getState();
      const ids = current.selection.includes(hit) ? current.selection : [hit];
      if (!current.selection.includes(hit)) setSelection(ids);
      beginDrag();
      interaction.current = {
        kind: 'move',
        start: point,
        base: store.getState().doc,
        ids,
        moved: false,
        leaf: leaf !== hit ? leaf : null,
      };
      return;
    }

    if (!event.shiftKey && !event.ctrlKey && !event.metaKey) setSelection([]);
    interaction.current = {
      kind: 'marquee',
      start: point,
      additive: event.shiftKey || event.ctrlKey || event.metaKey,
    };
    setMarquee({ x: point.x, y: point.y, w: 0, h: 0 });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const active = interaction.current;
    if (!active) {
      const point = toScene(event.clientX, event.clientY);
      setHovered(hitTest(scene, point, store.getState().selection));
      return;
    }

    if (active.kind === 'pan') {
      setPan(
        active.panX + (event.clientX - active.startX),
        active.panY + (event.clientY - active.startY),
      );
      return;
    }

    const point = toScene(event.clientX, event.clientY);

    if (active.kind === 'marquee') {
      setMarquee({
        x: Math.min(active.start.x, point.x),
        y: Math.min(active.start.y, point.y),
        w: Math.abs(point.x - active.start.x),
        h: Math.abs(point.y - active.start.y),
      });
      return;
    }

    if (active.kind === 'move') {
      let dx = point.x - active.start.x;
      let dy = point.y - active.start.y;
      const baseScene = active.base.scenes.find((entry) => entry.id === scene.id) ?? scene;
      const moving = unionRects(
        active.ids
          .map((id) => baseScene.nodes[id])
          .filter((node): node is SceneNode => node !== undefined),
      );
      if (prefs.editor.snap && moving) {
        const others = getRenderOrder(baseScene)
          .filter((id) => baseScene.nodes[id]?.type === 'widget' && !isWithin(baseScene, id, active.ids))
          .map((id) => baseScene.nodes[id])
          .filter((node): node is SceneNode => node !== undefined && isEffectivelyVisible(baseScene, node.id))
          .map((node) => ({ x: node.x, y: node.y, w: node.w, h: node.h }));
        const result = computeSnap(
          { x: moving.x + dx, y: moving.y + dy, w: moving.w, h: moving.h },
          others,
          { w: scene.width, h: scene.height },
          6 / zoom,
        );
        dx += result.dx;
        dy += result.dy;
        setGuides(result.guides);
      } else {
        setGuides([]);
      }
      dragDoc(withScene(active.base, scene.id, moveNodes(baseScene, active.ids, Math.round(dx), Math.round(dy))));
      if (Math.hypot(point.x - active.start.x, point.y - active.start.y) * zoom > 3) active.moved = true;
      const first = baseScene.nodes[active.ids[0]!];
      if (first) {
        setTip({
          x: event.clientX + 14,
          y: event.clientY + 14,
          text: `${Math.round(first.x + dx)}, ${Math.round(first.y + dy)}`,
        });
      }
      return;
    }

    const dx = point.x - active.start.x;
    const dy = point.y - active.start.y;
    const baseScene = active.base.scenes.find((entry) => entry.id === scene.id) ?? scene;
    const next = resizeRect(active.rect, active.handle, dx, dy, event.shiftKey, baseScene.nodes[active.id]);
    dragDoc(withScene(active.base, scene.id, setNodeRect(baseScene, active.id, next)));
    setTip({
      x: event.clientX + 14,
      y: event.clientY + 14,
      text: `${Math.round(next.w)} × ${Math.round(next.h)}`,
    });
  };

  const finish = (): void => {
    const active = interaction.current;
    interaction.current = null;
    setGuides([]);
    setTip(null);
    setPanning(false);
    if (!active) return;
    if (active.kind === 'move') {
      endDrag();
      if (!active.moved && active.leaf) setSelection([active.leaf]);
      return;
    }
    if (active.kind === 'resize') {
      endDrag();
      return;
    }
    if (active.kind === 'marquee' && marquee) {
      const box = marquee;
      setMarquee(null);
      if (box.w < 2 && box.h < 2) return;
      const hits = getRenderOrder(scene)
        .filter((id) => scene.nodes[id]?.type === 'widget')
        .filter((id) => isEffectivelyVisible(scene, id) && !isEffectivelyLocked(scene, id))
        .filter((id) => {
          const node = scene.nodes[id];
          return node ? rectsIntersect(box, { x: node.x, y: node.y, w: node.w, h: node.h }) : false;
        });
      setSelection(active.additive ? [...new Set([...selection, ...hits])] : hits);
      return;
    }
    setMarquee(null);
  };

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    const point = toScene(event.clientX, event.clientY);
    const hit = hitTest(scene, point, store.getState().selection);
    if (!hit) return;
    const node = scene.nodes[hit];
    if (node?.type === 'group') {
      store.set({ enteredGroupId: hit, selection: [] });
    }
  };

  const startResize = (handle: ResizeHandle, event: ReactPointerEvent<HTMLDivElement>): void => {
    event.stopPropagation();
    const id = selection[0];
    const node = id ? scene.nodes[id] : undefined;
    if (!id || !node) return;
    hostRef.current?.setPointerCapture(event.pointerId);
    beginDrag();
    interaction.current = {
      kind: 'resize',
      handle,
      start: toScene(event.clientX, event.clientY),
      base: store.getState().doc,
      id,
      rect: { x: node.x, y: node.y, w: node.w, h: node.h },
    };
  };

  return (
    <div
      ref={hostRef}
      className={['ns-canvas', panning ? 'is-panning' : ''].filter(Boolean).join(' ')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onPointerLeave={() => setHovered(null)}
      onDoubleClick={onDoubleClick}
      onDragOver={(event: ReactDragEvent<HTMLDivElement>) => {
        if (!event.dataTransfer.types.includes(WIDGET_MIME)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={(event: ReactDragEvent<HTMLDivElement>) => {
        const kind = event.dataTransfer.getData(WIDGET_MIME);
        if (!kind) return;
        event.preventDefault();
        const point = toScene(event.clientX, event.clientY);
        addWidget(kind, point.x, point.y);
      }}
      style={{ cursor: spaceDown ? 'grab' : undefined }}
    >
      <div
        className="ns-stage"
        style={{
          left: 0,
          top: 0,
          width: scene.width,
          height: scene.height,
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
        }}
      >
        <div className="ns-stage-checker" />
        {prefs.editor.showGrid ? (
          <div
            className="ns-stage-grid"
            style={{ backgroundSize: `${prefs.editor.gridSize}px ${prefs.editor.gridSize}px` }}
          />
        ) : null}
        <div className="ns-stage-content">
          {outputScene ? (
            <RenderProvider
              mode={outputPreview ? 'output' : 'editor'}
              stores={renderStores}
              mediaUrl={mediaUrl}
              reduceMotion={doc.settings.reduceMotion}
            >
              <SceneRenderer scene={outputScene} />
            </RenderProvider>
          ) : null}
        </div>
        <SelectionLayer
          scene={scene}
          selection={selection}
          hovered={hovered}
          zoom={zoom}
          onHandlePointerDown={startResize}
        />
        <MessageAreaLayer scene={scene} selection={selection} zoom={zoom} />
        <Guides guides={guides} width={scene.width} height={scene.height} />
        <Marquee rect={marquee} />
      </div>

      <CanvasToolbar />

      {meta.liveDiffers ? (
        <div className="ns-canvas-note">Editing preview — OBS shows the last published version</div>
      ) : null}

      {tip ? (
        <div className="ns-drag-tip" style={{ left: tip.x, top: tip.y }}>
          {tip.text}
        </div>
      ) : null}
    </div>
  );
}

function withScene(doc: ProjectDoc, sceneId: string, next: Scene): ProjectDoc {
  return {
    ...doc,
    scenes: doc.scenes.map((entry) => (entry.id === sceneId ? next : entry)),
    updatedAt: new Date().toISOString(),
  };
}

function resizeRect(
  rect: Rect,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  shift: boolean,
  node: SceneNode | undefined,
): Rect {
  let { x, y, w, h } = rect;
  if (handle.includes('w')) {
    x = rect.x + dx;
    w = rect.w - dx;
  }
  if (handle.includes('e')) w = rect.w + dx;
  if (handle.includes('n')) {
    y = rect.y + dy;
    h = rect.h - dy;
  }
  if (handle.includes('s')) h = rect.h + dy;

  const min = node ? minSizeOf(node) : { w: 4, h: 4 };
  if (w < min.w) {
    if (handle.includes('w')) x = rect.x + rect.w - min.w;
    w = min.w;
  }
  if (h < min.h) {
    if (handle.includes('n')) y = rect.y + rect.h - min.h;
    h = min.h;
  }

  const ratio = node ? aspectRatioOf(node) : null;
  const locked = ratio !== null || shift;
  if (locked) {
    const target = ratio ?? rect.w / Math.max(1, rect.h);
    if (handle === 'n' || handle === 's') {
      w = h * target;
      x = rect.x + (rect.w - w) / 2;
    } else {
      h = w / target;
      if (handle.includes('n')) y = rect.y + rect.h - h;
    }
  }

  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}
