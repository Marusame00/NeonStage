import type { ReactNode } from 'react';
import { toggleControls } from '../state/actions';
import { useEditor, type EditorState } from '../state/store';
import { IconButton } from '../ui/IconButton';
import { ControlsPanel } from './panels/ControlsPanel';

const selectControlsOpen = (state: EditorState) => state.controlsOpen;

const CLOSE_ICON = 'M6 6l12 12M18 6L6 18';

export function ControlsDrawer(): ReactNode {
  const open = useEditor(selectControlsOpen);
  if (!open) return null;

  return (
    <aside className="ns-controls-drawer">
      <header className="ns-panel-head">
        <h2>Stream controls</h2>
        <IconButton icon={CLOSE_ICON} label="Close controls" onClick={() => toggleControls(false)} />
      </header>
      <div className="ns-panel-body">
        <ControlsPanel />
      </div>
    </aside>
  );
}
