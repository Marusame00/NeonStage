import type { ReactNode } from 'react';
import type { OutputScene } from '../shared/output';
import { NodeView } from './NodeView';

export interface SceneRendererProps {
  scene: OutputScene;
  className?: string;
}

export function SceneRenderer({ scene, className }: SceneRendererProps): ReactNode {
  return (
    <div
      className={className}
      style={{
        position: 'relative',
        width: scene.viewport.w,
        height: scene.viewport.h,
        overflow: 'hidden',
        background: 'transparent',
      }}
    >
      {scene.nodes.map((node) => (
        <NodeView key={node.id} node={node} />
      ))}
    </div>
  );
}
