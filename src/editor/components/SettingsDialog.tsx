import { useEffect, type ReactNode } from 'react';
import { closeSettings, openSettings } from '../state/actions';
import { useEditor, type EditorState, type SettingsSection } from '../state/store';
import { Modal } from '../ui/Modal';
import { ConnectionsPanel } from './panels/ConnectionsPanel';
import { OutputsPanel } from './panels/OutputsPanel';

const SECTIONS: { id: SettingsSection; label: string }[] = [
  { id: 'connections', label: 'Connections' },
  { id: 'outputs', label: 'OBS output' },
];

const selectSettings = (state: EditorState) => ({
  open: state.settingsOpen,
  section: state.settingsSection,
  focusProvider: state.focusProvider,
});

export function SettingsDialog(): ReactNode {
  const { open, section, focusProvider } = useEditor(selectSettings);
  const active = SECTIONS.some((entry) => entry.id === section) ? section : SECTIONS[0]!.id;

  useEffect(() => {
    if (!open || !focusProvider) return;
    const target = document.getElementById(`ns-conn-${focusProvider}`);
    if (!target) return;
    const container = target.closest('.ns-settings-content');
    if (container instanceof HTMLElement) {
      container.scrollTop +=
        target.getBoundingClientRect().top - container.getBoundingClientRect().top;
    }
    target.classList.add('is-highlight');
    const timer = setTimeout(() => target.classList.remove('is-highlight'), 1200);
    return () => {
      clearTimeout(timer);
      target.classList.remove('is-highlight');
    };
  }, [open, focusProvider, active]);

  if (!open) return null;

  return (
    <Modal title="Settings" onClose={closeSettings} className="ns-settings">
      <div className="ns-settings-body">
        <nav className="ns-settings-nav">
          {SECTIONS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={['ns-settings-tab', entry.id === active ? 'is-active' : '']
                .filter(Boolean)
                .join(' ')}
              onClick={() => openSettings(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </nav>
        <div className="ns-settings-content">
          {active === 'connections' ? <ConnectionsPanel /> : <OutputsPanel />}
        </div>
      </div>
    </Modal>
  );
}
