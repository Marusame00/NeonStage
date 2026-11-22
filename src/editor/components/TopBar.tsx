import { useEffect, useRef, useState, type ReactNode } from 'react';
import { TEMPLATES } from '../../shared/templates';
import {
  adoptProject,
  openSettings,
  publish,
  refreshProjects,
  setLiveEdit,
  toast,
  toggleControls,
} from '../state/actions';
import { useEditor, store, type EditorState } from '../state/store';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { Toggle } from '../ui/Toggle';

const SETTINGS_ICON =
  'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z';

const selectTop = (state: EditorState) => ({
  app: state.app,
  meta: state.meta,
  projects: state.projects,
});

export function TopBar(): ReactNode {
  const { app, meta, projects } = useEditor(selectTop);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(meta.name);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent): void => {
      if (!wrapRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const run = async (action: () => Promise<void>): Promise<void> => {
    setMenuOpen(false);
    try {
      await action();
    } catch (error) {
      toast('error', error instanceof Error ? error.message : 'That action failed.');
    }
  };

  return (
    <header className="ns-topbar">
      <div className="ns-topbar-left">
        <div className="ns-brand">
          <svg className="ns-logo" viewBox="0 0 24 24" aria-hidden="true">
            <defs>
              <linearGradient id="ns-logo-gradient" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#ff3fd2" />
                <stop offset="100%" stopColor="#22e6ff" />
              </linearGradient>
            </defs>
            <path
              d="M4 20V4l16 16V4"
              fill="none"
              stroke="url(#ns-logo-gradient)"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="ns-appname">{app.name}</span>
        </div>

        <div className="ns-menu-wrap" ref={wrapRef}>
          <button
            type="button"
            className="ns-project-btn"
            onClick={() => {
              setMenuOpen(!menuOpen);
              void refreshProjects();
            }}
          >
            <span>{meta.name}</span>
            <svg viewBox="0 0 24 24" width={12} height={12} aria-hidden="true">
              <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth={2} />
            </svg>
          </button>
          {menuOpen ? (
            <div className="ns-menu">
              <div className="ns-menu-title">Projects</div>
              {projects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  className={['ns-menu-item', project.id === meta.projectId ? 'is-current' : '']
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() =>
                    void run(async () => {
                      adoptProject(await window.neonstage.openProject(project.id));
                      await refreshProjects();
                    })
                  }
                >
                  {project.name}
                </button>
              ))}
              <div className="ns-menu-sep" />
              <button
                type="button"
                className="ns-menu-item"
                onClick={() =>
                  void run(async () => {
                    adoptProject(await window.neonstage.createProject('Untitled overlay'));
                    await refreshProjects();
                  })
                }
              >
                New blank project
              </button>
              <div className="ns-menu-title">New from template</div>
              {TEMPLATES.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className="ns-menu-item"
                  title={template.description}
                  onClick={() =>
                    void run(async () => {
                      adoptProject(await window.neonstage.createProject(template.name, template.id));
                      await refreshProjects();
                    })
                  }
                >
                  {template.name}
                </button>
              ))}
              <div className="ns-menu-sep" />
              <button
                type="button"
                className="ns-menu-item"
                onClick={() =>
                  void run(async () => {
                    const imported = await window.neonstage.importProject();
                    if (imported) {
                      adoptProject(imported);
                      await refreshProjects();
                    }
                  })
                }
              >
                Import…
              </button>
              <button
                type="button"
                className="ns-menu-item"
                onClick={() =>
                  void run(async () => {
                    const result = await window.neonstage.exportProject();
                    if (!result.saved) return;
                    const missing = result.missingAssets?.length ?? 0;
                    toast(
                      missing > 0 ? 'warn' : 'info',
                      missing > 0
                        ? `Exported ${result.fileName ?? 'project'} — ${missing} asset(s) missing.`
                        : `Exported ${result.fileName ?? 'project'}.`,
                    );
                  })
                }
              >
                Export…
              </button>
              <button
                type="button"
                className="ns-menu-item"
                onClick={() => {
                  setNameDraft(meta.name);
                  setRenaming(true);
                }}
              >
                Rename…
              </button>
              {renaming ? (
                <form
                  className="ns-inline-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const next = nameDraft.trim();
                    setRenaming(false);
                    if (!next || next === meta.name) return;
                    void run(async () => {
                      const updated = await window.neonstage.renameProject(next);
                      store.set({ meta: updated });
                      await refreshProjects();
                    });
                  }}
                >
                  <input
                    className="ns-textinput"
                    autoFocus
                    value={nameDraft}
                    onChange={(event) => setNameDraft(event.target.value)}
                  />
                  <Button size="sm" variant="primary" type="submit">
                    Rename
                  </Button>
                </form>
              ) : null}
              <div className="ns-menu-sep" />
              <button
                type="button"
                className="ns-menu-item"
                onClick={() => void run(() => window.neonstage.revealDataFolder())}
              >
                Reveal data folder
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="ns-topbar-right">
        {meta.liveEdit ? <span className="ns-pill is-red">Live edit</span> : null}
        <span className={['ns-pill', meta.liveDiffers ? 'is-amber' : 'is-green'].join(' ')}>
          <span className="ns-dot" />
          {meta.liveDiffers ? 'Unpublished changes' : 'OBS up to date'}
        </span>
        <Button
          variant="primary"
          disabled={!meta.liveDiffers}
          onClick={() => void publish()}
          title="Send your changes to the OBS output (Ctrl+Enter)"
        >
          Publish to OBS
        </Button>
        <Button size="sm" onClick={() => toggleControls()} title="Stream controls">
          Controls
        </Button>
        <IconButton
          icon={SETTINGS_ICON}
          label="Settings"
          onClick={() => openSettings('connections')}
        />
        <Toggle
          label="Live edit"
          checked={meta.liveEdit}
          hint="Every change is sent to OBS immediately"
          onChange={(on) => void setLiveEdit(on)}
        />
      </div>
    </header>
  );
}
