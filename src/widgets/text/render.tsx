import type { ReactNode } from 'react';
import { hexToRgba } from '../../render/style';
import type { WidgetRenderProps } from '../render-contract';
import type { TextProps } from './definition';

export function TextRender({ props, style, width, height }: WidgetRenderProps<TextProps>): ReactNode {
  const justify =
    props.verticalAlign === 'middle' ? 'center' : props.verticalAlign === 'bottom' ? 'flex-end' : 'flex-start';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: justify,
        width,
        height,
        whiteSpace: props.wrap ? 'pre-wrap' : 'nowrap',
        overflow: props.wrap ? 'visible' : 'hidden',
        textOverflow: props.wrap ? undefined : 'ellipsis',
        textTransform: props.uppercase ? 'uppercase' : undefined,
        textShadow: style.glowEnabled
          ? `0 0 ${style.glowSize}px ${hexToRgba(style.glowColor, 0.75)}`
          : undefined,
      }}
    >
      {props.text}
    </div>
  );
}
