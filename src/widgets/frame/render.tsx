import type { ReactNode } from 'react';
import { hexToRgba } from '../../render/style';
import type { WidgetRenderProps } from '../render-contract';
import type { FrameProps } from './definition';

export function FrameRender({ node, props, style, mode, width, height }: WidgetRenderProps<FrameProps>): ReactNode {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const sw = Math.max(0, props.strokeWidth);
  const stroke = hexToRgba(props.strokeColor, 1);
  const accent = hexToRgba(props.strokeColor2, 1);
  const inset = sw / 2;
  const radius = Math.min(style.radius, Math.min(w, h) / 2);
  const hatchId = `${node.id}-hatch`;
  const labelSize = Math.max(11, Math.round(style.fontSize * 0.55));
  const labelWidth = Math.min(w, props.label.length * labelSize * 0.68 + labelSize * 1.2);
  const labelHeight = labelSize * 1.7;

  let border: ReactNode;
  switch (props.style) {
    case 'neon':
      border = (
        <g fill="none">
          <rect
            x={inset}
            y={inset}
            width={Math.max(0, w - sw)}
            height={Math.max(0, h - sw)}
            rx={radius}
            stroke={stroke}
            strokeWidth={Math.max(1, sw)}
            vectorEffect="non-scaling-stroke"
          />
          <rect
            x={inset + sw + 2}
            y={inset + sw + 2}
            width={Math.max(0, w - sw * 2 - 4)}
            height={Math.max(0, h - sw * 2 - 4)}
            rx={Math.max(0, radius - 2)}
            stroke={accent}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      );
      break;
    case 'minimal':
      border = (
        <rect
          x={inset}
          y={inset}
          width={Math.max(0, w - sw)}
          height={Math.max(0, h - sw)}
          rx={radius}
          fill="none"
          stroke={stroke}
          strokeWidth={Math.max(1, sw / 2)}
          vectorEffect="non-scaling-stroke"
        />
      );
      break;
    case 'brackets': {
      const arm = Math.min(Math.max(0, props.cornerSize), Math.min(w, h) / 2);
      const d = [
        `M 0 ${arm} L 0 0 L ${arm} 0`,
        `M ${w - arm} 0 L ${w} 0 L ${w} ${arm}`,
        `M ${w} ${h - arm} L ${w} ${h} L ${w - arm} ${h}`,
        `M ${arm} ${h} L 0 ${h} L 0 ${h - arm}`,
      ].join(' ');
      border = (
        <path
          d={d}
          fill="none"
          stroke={stroke}
          strokeWidth={Math.max(1, sw)}
          vectorEffect="non-scaling-stroke"
        />
      );
      break;
    }
    case 'double':
      border = (
        <g fill="none" stroke={stroke} vectorEffect="non-scaling-stroke">
          <rect
            x={inset}
            y={inset}
            width={Math.max(0, w - sw)}
            height={Math.max(0, h - sw)}
            rx={radius}
            strokeWidth={Math.max(1, sw / 2)}
          />
          <rect
            x={inset + sw + 4}
            y={inset + sw + 4}
            width={Math.max(0, w - sw * 2 - 8)}
            height={Math.max(0, h - sw * 2 - 8)}
            rx={Math.max(0, radius - 2)}
            strokeWidth={Math.max(1, sw / 2)}
          />
        </g>
      );
      break;
    case 'rounded': {
      const thick = Math.max(1, sw);
      border = (
        <rect
          x={inset}
          y={inset}
          width={Math.max(0, w - sw)}
          height={Math.max(0, h - sw)}
          rx={Math.min(w, h) * 0.1}
          fill="none"
          stroke={stroke}
          strokeWidth={thick}
          vectorEffect="non-scaling-stroke"
        />
      );
      break;
    }
  }

  const placeholder = mode === 'editor' && props.showPlaceholder;
  const caption = props.purpose === 'webcam' ? 'WEBCAM AREA' : 'GAME CAPTURE AREA';

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={{ display: 'block', overflow: 'visible' }}
    >
      <defs>
        <pattern
          id={hatchId}
          width={16}
          height={16}
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line x1={0} y1={0} x2={0} y2={16} stroke={hexToRgba(props.strokeColor, 0.22)} strokeWidth={2} />
        </pattern>
      </defs>
      {placeholder ? (
        <g>
          <rect
            x={inset}
            y={inset}
            width={Math.max(0, w - sw)}
            height={Math.max(0, h - sw)}
            rx={radius}
            fill={`url(#${hatchId})`}
          />
          <text
            x={w / 2}
            y={h / 2 - 4}
            textAnchor="middle"
            dominantBaseline="middle"
            fill={hexToRgba(props.strokeColor, 0.85)}
            fontFamily={style.fontFamily}
            fontSize={Math.max(12, Math.round(style.fontSize * 0.6))}
            fontWeight={600}
            letterSpacing={2}
          >
            {caption}
          </text>
          <text
            x={w / 2}
            y={h / 2 + Math.max(16, style.fontSize * 0.9)}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="rgba(255, 230, 247, 0.55)"
            fontFamily={style.fontFamily}
            fontSize={Math.max(10, Math.round(style.fontSize * 0.4))}
          >
            Editor only · not shown in OBS
          </text>
        </g>
      ) : null}
      {border}
      {props.showLabel && props.label.length > 0 ? (
        <g>
          <rect
            x={inset + Math.max(0, sw)}
            y={inset + Math.max(0, sw)}
            width={labelWidth}
            height={labelHeight}
            rx={Math.min(4, labelHeight / 2)}
            fill={hexToRgba(props.strokeColor, 0.85)}
          />
          <text
            x={inset + Math.max(0, sw) + labelWidth / 2}
            y={inset + Math.max(0, sw) + labelHeight / 2}
            textAnchor="middle"
            dominantBaseline="middle"
            fill={hexToRgba('#120a24', 1)}
            fontFamily={style.fontFamily}
            fontSize={labelSize}
            fontWeight={700}
            letterSpacing={1}
          >
            {props.label}
          </text>
        </g>
      ) : null}
    </svg>
  );
}
