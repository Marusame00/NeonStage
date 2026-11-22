import type { ReactNode } from 'react';
import { useRuntime } from '../../render/RenderContext';
import { hexToRgba } from '../../render/style';
import type { WidgetRenderProps } from '../render-contract';
import type { GoalProps } from './definition';

export function GoalRender({ node, props, style, width, height }: WidgetRenderProps<GoalProps>): ReactNode {
  const runtime = useRuntime();
  const current = runtime.goals[node.id]?.current ?? props.startValue;
  const target = props.target > 0 ? props.target : 1;
  const pct = Math.min(1, Math.max(0, current / target));
  const radius = Math.max(0, style.radius);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6, width, height }}>
      {props.title ? <div>{props.title}</div> : null}
      <div
        style={{
          width: '100%',
          height: props.barHeight,
          borderRadius: radius,
          background: hexToRgba(props.trackColor, props.trackOpacity),
          overflow: 'hidden',
        }}
      >
        <div
          className={style.animate ? 'ns-anim ns-goal-fill' : undefined}
          style={{
            width: `${pct * 100}%`,
            height: '100%',
            borderRadius: radius,
            background: `linear-gradient(90deg, ${hexToRgba(props.barColor, 1)}, ${hexToRgba(props.barColor2, 1)})`,
          }}
        />
      </div>
      {props.showNumbers || props.showPercent ? (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: '0.7em' }}>
          <span>{props.showNumbers ? `${current} / ${target} ${props.unit}`.trim() : null}</span>
          <span>{props.showPercent ? `${Math.round(pct * 100)}%` : null}</span>
        </div>
      ) : null}
    </div>
  );
}
