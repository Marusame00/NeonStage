import type { ReactNode } from 'react';
import { useRuntime, useServerNow } from '../../render/RenderContext';
import { formatDuration, timerElapsedMs, type TimerRuntime } from '../../shared/runtime';
import type { WidgetRenderProps } from '../render-contract';
import type { TimerProps } from './definition';

const EMPTY_TIMER: TimerRuntime = { running: false, startedAt: null, accumulatedMs: 0 };

export function TimerRender({ node, props, width, height }: WidgetRenderProps<TimerProps>): ReactNode {
  const runtime = useRuntime();
  const serverNow = useServerNow(250);
  const elapsed = timerElapsedMs(runtime.timers[node.id] ?? EMPTY_TIMER, serverNow);

  let value: string;
  if (props.mode === 'countdown') {
    const remaining = Math.max(0, props.durationMs - elapsed);
    value = remaining === 0 && props.endText ? props.endText : formatDuration(remaining, props.format);
  } else {
    value = formatDuration(elapsed, props.format);
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        width,
        height,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {props.showLabel && props.label ? (
        <div style={{ fontSize: '0.5em', opacity: 0.75, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          {props.label}
        </div>
      ) : null}
      <div>{value}</div>
    </div>
  );
}
