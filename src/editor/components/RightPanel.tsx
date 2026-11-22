import type { ReactNode } from 'react';
import { Inspector } from './Inspector/Inspector';
import { LayersPanel } from './LayersPanel';

export function RightPanel(): ReactNode {
  return (
    <aside className="ns-right">
      <LayersPanel />
      <section className="ns-panel ns-inspector">
        <header className="ns-panel-head">
          <h2>Inspector</h2>
        </header>
        <div className="ns-panel-body">
          <Inspector />
        </div>
      </section>
    </aside>
  );
}
