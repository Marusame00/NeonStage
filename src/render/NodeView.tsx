import { memo, useMemo, type CSSProperties, type ReactNode } from 'react';
import { defaultStyle } from '../shared/model';
import type { OutputNode } from '../shared/output';
import { getWidget } from '../widgets/registry';
import { getRenderer } from '../widgets/renderers';
import { useRenderContext } from './RenderContext';
import { boxStyle, textStyle, type StyleWithVars } from './style';

const serialCache = new WeakMap<OutputNode, string>();

function serialize(node: OutputNode): string {
  const cached = serialCache.get(node);
  if (cached !== undefined) return cached;
  const json = JSON.stringify(node);
  serialCache.set(node, json);
  return json;
}

function placeholderStyle(): CSSProperties {
  return {
    position: 'absolute',
    left: 0,
    top: 0,
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px dashed rgba(255, 63, 210, 0.6)',
    borderRadius: 4,
    color: 'rgba(255, 230, 247, 0.75)',
    fontFamily: '"Bahnschrift", "Segoe UI", sans-serif',
    fontSize: 14,
    letterSpacing: 0.4,
    boxSizing: 'border-box',
    overflow: 'hidden',
    textAlign: 'center',
    padding: 4,
    background: 'transparent',
  };
}

function NodeViewInner({ node }: { node: OutputNode }): ReactNode {
  const { mode } = useRenderContext();
  const widget = node.widget;
  const definition = widget ? getWidget(widget.kind) : undefined;
  const Renderer = widget ? getRenderer(widget.kind) : undefined;
  const props = useMemo(
    () => (definition && widget ? definition.validate(widget.props) : null),
    [definition, widget],
  );
  const style = node.style ?? defaultStyle();
  const caps = definition?.styleCapabilities ?? [];
  const inset =
    (caps.includes('padding') ? style.padding : 0) +
    (caps.includes('border') && style.borderWidth > 0 ? style.borderWidth : 0);
  const width = Math.max(0, node.w - 2 * inset);
  const height = Math.max(0, node.h - 2 * inset);

  const containerStyle: StyleWithVars = {
    position: 'absolute',
    left: node.x,
    top: node.y,
    width: node.w,
    height: node.h,
    opacity: node.opacity,
    boxSizing: 'border-box',
    overflow: 'visible',
    contain: 'layout style',
    '--ns-speed': style.animationSpeed,
    ...boxStyle(style, caps),
    ...textStyle(style, caps),
  };

  if (!definition || !Renderer || !props) {
    if (mode === 'output') return null;
    return (
      <div style={containerStyle}>
        <div style={placeholderStyle()}>
          {`Unknown widget: ${widget?.kind ?? 'unknown'}`}
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <Renderer
        node={node}
        props={props}
        style={style}
        mode={mode}
        width={width}
        height={height}
      />
    </div>
  );
}

export const NodeView = memo(
  NodeViewInner,
  (previous, next) => previous.node === next.node || serialize(previous.node) === serialize(next.node),
);
