import type { ReactNode } from 'react';
import { hexToRgba } from '../../render/style';
import type { WidgetRenderProps } from '../render-contract';
import type { ShapeProps } from './definition';

export function ShapeRender({ node, props, style, width, height }: WidgetRenderProps<ShapeProps>): ReactNode {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const sw = props.strokeWidth;
  const lineWidth = Math.max(1, sw);
  const fill = hexToRgba(props.fillColor, props.fillOpacity);
  const stroke = hexToRgba(props.strokeColor, props.strokeOpacity);
  const dash = props.dash ? `${Math.max(4, sw * 2)} ${Math.max(3, sw * 1.5)}` : undefined;
  const gradientId = `${node.id}-fill`;
  const sunGradientId = `${node.id}-sun`;
  const maskId = `${node.id}-mask`;
  const rad = (props.angle * Math.PI) / 180;
  const dx = Math.cos(rad) / 2;
  const dy = Math.sin(rad) / 2;
  const fillValue = props.gradient ? `url(#${gradientId})` : fill;
  const glow = style.glowEnabled
    ? `drop-shadow(0 0 ${style.glowSize}px ${hexToRgba(style.glowColor, 0.75)})`
    : undefined;

  const strokeProps = {
    stroke,
    strokeWidth: lineWidth,
    strokeDasharray: dash,
    vectorEffect: 'non-scaling-stroke' as const,
  };

  let shape: ReactNode;
  switch (props.shape) {
    case 'rect': {
      const inset = sw / 2;
      shape = (
        <rect
          x={inset}
          y={inset}
          width={Math.max(0, w - sw)}
          height={Math.max(0, h - sw)}
          rx={Math.min(style.radius, Math.min(w, h) / 2)}
          fill={fillValue}
          {...strokeProps}
        />
      );
      break;
    }
    case 'ellipse':
      shape = (
        <ellipse
          cx={w / 2}
          cy={h / 2}
          rx={Math.max(0, w / 2 - sw / 2)}
          ry={Math.max(0, h / 2 - sw / 2)}
          fill={fillValue}
          {...strokeProps}
        />
      );
      break;
    case 'line':
      shape = (
        <line x1={sw / 2} y1={h / 2} x2={w - sw / 2} y2={h / 2} fill="none" {...strokeProps} />
      );
      break;
    case 'divider': {
      const size = Math.min(h / 2, Math.max(4, sw * 2));
      shape = (
        <g fill="none">
          <line x1={sw / 2} y1={h / 2} x2={w - sw / 2} y2={h / 2} {...strokeProps} />
          <path
            d={`M ${w / 2} ${h / 2 - size} L ${w / 2 + size} ${h / 2} L ${w / 2} ${h / 2 + size} L ${w / 2 - size} ${h / 2} Z`}
            fill={stroke}
            stroke={stroke}
            strokeWidth={lineWidth}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      );
      break;
    }
    case 'chevrons': {
      const step = Math.max(8, h * 0.55);
      const count = Math.max(1, Math.ceil(w / step) + 1);
      const paths: string[] = [];
      for (let index = 0; index < count; index += 1) {
        const x = index * step;
        paths.push(`M ${x} ${h * 0.15} L ${x + h * 0.35} ${h * 0.5} L ${x} ${h * 0.85}`);
      }
      shape = <path d={paths.join(' ')} fill="none" {...strokeProps} />;
      break;
    }
    case 'corner-brackets': {
      const arm = Math.min(w, h) * 0.18;
      const d = [
        `M 0 ${arm} L 0 0 L ${arm} 0`,
        `M ${w - arm} 0 L ${w} 0 L ${w} ${arm}`,
        `M ${w} ${h - arm} L ${w} ${h} L ${w - arm} ${h}`,
        `M ${arm} ${h} L 0 ${h} L 0 ${h - arm}`,
      ].join(' ');
      shape = <path d={d} fill="none" {...strokeProps} />;
      break;
    }
    case 'grid': {
      const columns = 10;
      const rows = 8;
      const paths: string[] = [];
      for (let index = -columns; index <= columns; index += 1) {
        const ratio = index / columns;
        paths.push(`M ${w / 2 + ratio * w * 0.08} 0 L ${w / 2 + ratio * w * 0.9} ${h}`);
      }
      for (let index = 1; index <= rows; index += 1) {
        const y = h * (index / rows) ** 2;
        paths.push(`M 0 ${y} L ${w} ${y}`);
      }
      shape = <path d={paths.join(' ')} fill="none" {...strokeProps} />;
      break;
    }
    case 'sun': {
      const radius = Math.max(0, Math.min(w, h) / 2 - sw / 2);
      const stripeHeight = Math.max(1, h * 0.025);
      const stripes: number[] = [];
      for (let y = h * 0.55; y < h; y += h * 0.06) stripes.push(y);
      shape = (
        <g>
          <mask id={maskId} maskUnits="userSpaceOnUse" x={0} y={0} width={w} height={h}>
            <rect x={0} y={0} width={w} height={h} fill="#ffffff" />
            {stripes.map((y) => (
              <rect key={y} x={0} y={y} width={w} height={stripeHeight} fill="#000000" />
            ))}
          </mask>
          <circle
            cx={w / 2}
            cy={h / 2}
            r={radius}
            fill={`url(#${sunGradientId})`}
            mask={`url(#${maskId})`}
            stroke={sw > 0 ? stroke : undefined}
            strokeWidth={sw > 0 ? lineWidth : undefined}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      );
      break;
    }
  }

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={{ display: 'block', overflow: 'visible', filter: glow }}
    >
      <defs>
        <linearGradient
          id={gradientId}
          x1={0.5 - dx}
          y1={0.5 - dy}
          x2={0.5 + dx}
          y2={0.5 + dy}
        >
          <stop offset="0" stopColor={hexToRgba(props.fillColor, props.fillOpacity)} />
          <stop offset="1" stopColor={hexToRgba(props.fill2Color, props.fillOpacity)} />
        </linearGradient>
        <linearGradient id={sunGradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={hexToRgba(props.fillColor, props.fillOpacity)} />
          <stop offset="1" stopColor={hexToRgba(props.fill2Color, props.fillOpacity)} />
        </linearGradient>
      </defs>
      {shape}
    </svg>
  );
}
