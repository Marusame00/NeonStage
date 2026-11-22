import { useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import '../render/render.css';
import './overlay.css';
import { parseOutputPath, type OutputScene } from '../shared/output';
import type { ServerMessage } from '../shared/protocol';
import { FitStage } from '../render/FitStage';
import { RenderProvider } from '../render/RenderContext';
import { SceneRenderer } from '../render/SceneRenderer';
import { createRenderStores } from '../render/stores';

const target = parseOutputPath(location.pathname, 'output');
const fit = new URLSearchParams(location.search).get('fit') === 'none' ? 'none' : 'contain';
const mediaUrl = (assetId: string): string => `/media/${encodeURIComponent(assetId)}`;

function OutputApp(): ReactNode {
  const [stores] = useState(createRenderStores);
  const [scene, setScene] = useState<OutputScene | null>(null);

  useEffect(() => {
    if (!target) return;
    const suffix = location.pathname.replace(/^\/output/, '');
    const source = new EventSource(`/events${suffix}`);
    let warned = false;

    source.onmessage = (event: MessageEvent<string>) => {
      const message = JSON.parse(event.data) as ServerMessage;
      switch (message.t) {
        case 'snapshot':
          stores.runtime.set(message.runtime, message.serverNow);
          stores.chat.reset(message.chat);
          stores.status.set(message.providers);
          setScene(message.scene);
          break;
        case 'scene':
          setScene(message.scene);
          break;
        case 'runtime':
          stores.runtime.set(message.runtime, message.serverNow);
          break;
        case 'chat':
          stores.chat.apply(message.ops);
          break;
        case 'providers':
          stores.status.set(message.providers);
          break;
        case 'ping':
          stores.runtime.setServerNow(message.serverNow);
          break;
      }
    };

    source.onerror = () => {
      if (warned) return;
      warned = true;
      console.warn('NeonStage output: connection lost, keeping the last scene');
    };

    return () => source.close();
  }, [stores]);

  if (!target || !scene) return null;

  return (
    <RenderProvider
      mode="output"
      stores={stores}
      mediaUrl={mediaUrl}
      reduceMotion={scene.reduceMotion}
    >
      <div className={scene.reduceMotion ? 'ns-reduce-motion' : undefined} style={{ width: '100%', height: '100%' }}>
        <FitStage width={scene.viewport.w} height={scene.viewport.h} fit={fit}>
          <SceneRenderer scene={scene} />
        </FitStage>
      </div>
    </RenderProvider>
  );
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<OutputApp />);
}
