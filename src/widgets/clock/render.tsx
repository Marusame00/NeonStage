import type { ReactNode } from 'react';
import { useRuntime, useServerNow } from '../../render/RenderContext';
import { formatDuration } from '../../shared/runtime';
import type { WidgetRenderProps } from '../render-contract';
import type { ClockProps } from './definition';

export function ClockRender({ props, width, height }: WidgetRenderProps<ClockProps>): ReactNode {
  const runtime = useRuntime();
  const serverNow = useServerNow(props.showSeconds ? 250 : 1000);

  let value: string;
  if (props.mode === 'session-elapsed') {
    value =
      runtime.session.startedAt === null
        ? '--:--'
        : formatDuration(serverNow - runtime.session.startedAt, 'hh:mm:ss');
  } else {
    const options: Intl.DateTimeFormatOptions = {
      hour: '2-digit',
      minute: '2-digit',
      hour12: props.hour12,
    };
    if (props.showSeconds) options.second = '2-digit';
    value = new Intl.DateTimeFormat(undefined, options).format(new Date(serverNow));
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
