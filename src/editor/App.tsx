import { useEffect, type ReactNode } from 'react';
import { bootstrap } from './state/actions';
import { installKeyboard } from './state/keyboard';
import { useEditor, type EditorState } from './state/store';
import { CanvasView } from './components/Canvas/CanvasView';
import { ControlsDrawer } from './components/ControlsDrawer';
import { LibraryPanel } from './components/LibraryPanel';
import { RightPanel } from './components/RightPanel';
import { ScenesPanel } from './components/ScenesPanel';
import { SettingsDialog } from './components/SettingsDialog';
import { StatusBar } from './components/StatusBar';
import { Toasts } from './components/Toasts';
import { TopBar } from './components/TopBar';

const selectReady = (state: EditorState) => state.ready;

export function App(): ReactNode {
  const ready = useEditor(selectReady);

  useEffect(() => {
    void bootstrap();
    return installKeyboard();
  }, []);

  if (!ready) {
    return <div className="ns-loading">Loading NeonStage…</div>;
  }

  return (
    <div className="ns-app">
      <TopBar />
      <div className="ns-main">
        <aside className="ns-left">
          <ScenesPanel />
          <LibraryPanel />
        </aside>
        <main className="ns-center">
          <CanvasView />
        </main>
        <RightPanel />
      </div>
      <StatusBar />
      <ControlsDrawer />
      <SettingsDialog />
      <Toasts />
    </div>
  );
}
