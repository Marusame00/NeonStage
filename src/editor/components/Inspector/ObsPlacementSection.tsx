import { useState, type ReactNode } from 'react';
import type { SceneNode } from '../../../shared/model';
import {
  alignedObsPosition,
  computeObsPlacement,
  formatObsNumber,
  formatObsPlacementText,
  isObsAlignment,
  OBS_ALIGNMENTS,
  type ObsAlignment,
} from '../../../shared/obsPlacement';
import { toast } from '../../state/actions';
import { Button } from '../../ui/Button';
import { NumberField } from '../../ui/NumberField';
import { Section } from '../../ui/Section';
import { Select } from '../../ui/Select';

const STORAGE_KEY = 'neonstage.obsCanvas';

interface CanvasSize {
  w: number;
  h: number;
}

export interface ObsPlacementSectionProps {
  node: SceneNode;
  sceneWidth: number;
  sceneHeight: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

async function copyPlacement(text: string): Promise<void> {
  try {
    await window.neonstage.copyText(text);
    toast('info', 'Copied');
  } catch (error) {
    toast('error', errorMessage(error));
  }
}

function readCanvas(sceneWidth: number, sceneHeight: number): CanvasSize {
  const fallback = { w: sceneWidth, h: sceneHeight };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<CanvasSize>;
    const w = Number(parsed.w);
    const h = Number(parsed.h);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return { w, h };
    return fallback;
  } catch {
    return fallback;
  }
}

function saveCanvas(size: CanvasSize): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(size));
  } catch {
    toast('error', 'Could not save the OBS canvas size.');
  }
}

const ANCHOR_KEY = 'neonstage.obsAlignment';

function readAnchors(): Record<string, ObsAlignment> {
  try {
    const raw = window.localStorage.getItem(ANCHOR_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const result: Record<string, ObsAlignment> = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (isObsAlignment(value)) result[id] = value;
    }
    return result;
  } catch {
    return {};
  }
}

function saveAnchors(anchors: Record<string, ObsAlignment>): void {
  try {
    window.localStorage.setItem(ANCHOR_KEY, JSON.stringify(anchors));
  } catch {
    toast('error', 'Could not save the OBS alignment.');
  }
}

function ValueRow({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div className="ns-field">
      <span className="ns-field-label">{label}</span>
      <span className="ns-url">{value}</span>
    </div>
  );
}

export function ObsPlacementSection({
  node,
  sceneWidth,
  sceneHeight,
}: ObsPlacementSectionProps): ReactNode {
  const [canvas, setCanvas] = useState<CanvasSize>(() => readCanvas(sceneWidth, sceneHeight));
  const [align, setAlign] = useState<'outer' | 'inner'>('outer');
  const [anchors, setAnchors] = useState<Record<string, ObsAlignment>>(readAnchors);
  const anchor = anchors[node.id] ?? 'top-left';
  const setAnchor = (value: string): void => {
    if (!isObsAlignment(value)) return;
    const next = { ...anchors, [node.id]: value };
    setAnchors(next);
    saveAnchors(next);
  };
  const isFrame = node.widget?.kind === 'frame';
  const purpose = isFrame ? node.widget?.props.purpose : undefined;
  const target =
    purpose === 'webcam' ? 'webcam source' : purpose === 'game' ? 'game capture source' : 'source';
  const strokeWidth = Number(node.widget?.props.strokeWidth) || 0;
  const inset = isFrame && align === 'inner' ? strokeWidth : 0;
  const placement = computeObsPlacement({
    rect: { x: node.x, y: node.y, w: node.w, h: node.h },
    sceneWidth,
    sceneHeight,
    canvasWidth: canvas.w,
    canvasHeight: canvas.h,
    inset,
  });
  const position = alignedObsPosition(placement, anchor);

  const setCanvasW = (value: number): void => {
    const next = { w: value, h: canvas.h };
    setCanvas(next);
    saveCanvas(next);
  };
  const setCanvasH = (value: number): void => {
    const next = { w: canvas.w, h: value };
    setCanvas(next);
    saveCanvas(next);
  };
  const useSceneSize = (): void => {
    const next = { w: sceneWidth, h: sceneHeight };
    setCanvas(next);
    saveCanvas(next);
  };

  return (
    <Section title="OBS placement" defaultOpen={isFrame}>
      <div className="ns-grid-2">
        <NumberField label="Canvas W" value={canvas.w} min={16} onChange={setCanvasW} />
        <NumberField label="Canvas H" value={canvas.h} min={16} onChange={setCanvasH} />
      </div>
      <div className="ns-row">
        <Button size="sm" onClick={useSceneSize}>
          Use scene size
        </Button>
      </div>
      <p className="ns-hint">Your OBS Base (Canvas) Resolution — Settings → Video.</p>

      {isFrame ? (
        <Select
          label="Line up with"
          value={align}
          options={[
            { value: 'outer', label: 'Outer edge' },
            { value: 'inner', label: 'Inside stroke' },
          ]}
          onChange={(value) => setAlign(value === 'inner' ? 'inner' : 'outer')}
        />
      ) : null}

      <Select
        label="OBS alignment"
        value={anchor}
        options={OBS_ALIGNMENTS.map((entry) => ({ value: entry.value, label: entry.label }))}
        onChange={setAnchor}
      />
      <p className="ns-hint">
        Match the highlighted dot in the Alignment grid of OBS&apos;s Edit Transform for this source.
      </p>

      <div className="ns-grid-2">
        <ValueRow label="Position X" value={formatObsNumber(position.x)} />
        <ValueRow label="Position Y" value={formatObsNumber(position.y)} />
        <ValueRow label="Width" value={formatObsNumber(placement.w)} />
        <ValueRow label="Height" value={formatObsNumber(placement.h)} />
      </div>
      <p className="ns-hint">
        Rotation 0 · Crop 0 · Width/Height go in Size (or Bounding Box Size with Stretch to bounds)
      </p>
      <div className="ns-row">
        <Button
          size="sm"
          onClick={() => void copyPlacement(formatObsPlacementText(node.name, placement, anchor))}
        >
          Copy all
        </Button>
      </div>
      <p className="ns-hint">
        In OBS, right-click your {target} → Transform → Edit Transform (Ctrl+E) and enter these
        values. Assumes the NeonStage Browser Source covers the whole OBS canvas at 0,0. If your
        source&apos;s aspect ratio differs from the box, pick &apos;Scale to inner bounds&apos; to
        avoid stretching.
      </p>

      {placement.aspectMismatch ? (
        <div className="ns-callout is-warn">
          The scene and OBS canvas aspect ratios differ, so these values include the letterbox
          offset the Browser Source adds.
        </div>
      ) : null}
    </Section>
  );
}
