import { useState, type ReactNode } from 'react';
import { useRenderContext } from '../../render/RenderContext';
import type { WidgetRenderProps } from '../render-contract';
import type { ImageProps } from './definition';

function placeholder(text: string, width: number, height: number): ReactNode {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width,
        height,
        border: '1px dashed rgba(255, 63, 210, 0.6)',
        borderRadius: 4,
        color: 'rgba(255, 230, 247, 0.75)',
        fontSize: 14,
        letterSpacing: 0.4,
        boxSizing: 'border-box',
        textAlign: 'center',
      }}
    >
      {text}
    </div>
  );
}

export function ImageRender({ props, mode, width, height }: WidgetRenderProps<ImageProps>): ReactNode {
  const { mediaUrl } = useRenderContext();
  const [failed, setFailed] = useState(false);

  if (!props.assetId) {
    return mode === 'editor' ? placeholder('No image selected', width, height) : null;
  }
  if (failed) {
    return mode === 'editor' ? placeholder('Missing image', width, height) : null;
  }

  return (
    <img
      src={mediaUrl(props.assetId)}
      alt={props.alt}
      onError={() => setFailed(true)}
      style={{ display: 'block', width, height, objectFit: props.fit }}
    />
  );
}
