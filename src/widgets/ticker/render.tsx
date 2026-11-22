import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRenderContext, useServerNow } from '../../render/RenderContext';
import type { StyleWithVars } from '../../render/style';
import type { WidgetRenderProps } from '../render-contract';
import type { TickerProps } from './definition';

export function TickerRender({ props, style, width, height }: WidgetRenderProps<TickerProps>): ReactNode {
  const { reduceMotion } = useRenderContext();
  const animate = style.animate && !reduceMotion;
  const serverNow = useServerNow(props.mode === 'rotate' ? 250 : 0);
  const contentRef = useRef<HTMLSpanElement>(null);
  const [contentWidth, setContentWidth] = useState(0);

  const text = props.items.join(props.separator);
  const loopText = props.items.length === 0 ? '' : `${text}${props.separator}`;

  useEffect(() => {
    const element = contentRef.current;
    if (!element) return;
    const measure = (): void => setContentWidth(element.scrollWidth);
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [loopText]);

  if (props.mode === 'rotate') {
    if (props.items.length === 0) return null;
    const index = Math.floor(serverNow / (props.rotateSeconds * 1000)) % props.items.length;
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          width,
          height,
          overflow: 'hidden',
          whiteSpace: 'nowrap',
        }}
      >
        <span key={index} className={animate ? 'ns-anim ns-rotate-item' : undefined} style={{ whiteSpace: 'pre' }}>
          {props.items[index]}
        </span>
      </div>
    );
  }

  if (!animate) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          width,
          height,
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          textOverflow: 'ellipsis',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'pre' }}>{text}</span>
      </div>
    );
  }

  const duration = contentWidth > 0 ? contentWidth / Math.max(1, props.speed) : 0;
  const trackStyle: StyleWithVars = {
    display: 'flex',
    alignItems: 'center',
    whiteSpace: 'nowrap',
    willChange: 'transform',
    '--ns-ticker-distance': `${contentWidth}px`,
    animationDuration: `${duration}s`,
    animationDirection: props.direction === 'right' ? 'reverse' : 'normal',
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', width, height, overflow: 'hidden' }}>
      <div className="ns-anim ns-ticker-track" style={trackStyle}>
        <span ref={contentRef} style={{ whiteSpace: 'pre' }}>{loopText}</span>
        <span aria-hidden="true" style={{ whiteSpace: 'pre' }}>{loopText}</span>
      </div>
    </div>
  );
}
