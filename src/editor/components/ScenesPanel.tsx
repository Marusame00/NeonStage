import { useState, type ReactNode } from 'react';
import { CANVAS_PRESETS } from '../../shared/model';
import { TEMPLATES } from '../../shared/templates';
import {
  addTemplateScene,
  createNewScene,
  deleteScene,
  duplicateActiveScene,
  renameSceneAction,
  selectSceneAction,
  setProgramScene,
} from '../state/actions';
import { useEditor, type EditorState } from '../state/store';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';

const selectScenes = (state: EditorState) => ({
  scenes: state.doc.scenes,
  activeSceneId: state.activeSceneId,
  programSceneId: state.meta.programSceneId,
});

const ICONS = {
  duplicate: 'M8 8h12v12H8zM4 16V4h12',
  remove: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  program: 'M6 3v18M6 4h12l-2 4 2 4H6',
  plus: 'M12 5v14M5 12h14',
};

export function ScenesPanel(): ReactNode {
  const { scenes, activeSceneId, programSceneId } = useEditor(selectScenes);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('Scene');
  const [preset, setPreset] = useState(CANVAS_PRESETS[0]!.id);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  return (
    <section className="ns-panel">
      <header className="ns-panel-head">
        <h2>Scenes</h2>
        <div className="ns-panel-actions">
          <IconButton
            icon={ICONS.plus}
            label="New scene"
            onClick={() => setCreating(!creating)}
            active={creating}
          />
          <IconButton icon={ICONS.duplicate} label="Duplicate scene" onClick={duplicateActiveScene} />
          <IconButton
            icon={ICONS.remove}
            label="Delete scene"
            onClick={() => {
              if (scenes.length <= 1) return;
              if (!window.confirm(`Delete scene "${scenes.find((scene) => scene.id === activeSceneId)?.name ?? ''}"?`)) return;
              deleteScene(activeSceneId);
            }}
          />
        </div>
      </header>
      <div className="ns-panel-body">
        {creating ? (
          <form
            className="ns-inline-form"
            onSubmit={(event) => {
              event.preventDefault();
              createNewScene(name, preset);
              setCreating(false);
              setName('Scene');
            }}
          >
            <input
              className="ns-textinput"
              autoFocus
              value={name}
              placeholder="Scene name"
              onChange={(event) => setName(event.target.value)}
            />
            <select
              className="ns-textinput"
              value={preset}
              onChange={(event) => setPreset(event.target.value)}
            >
              {CANVAS_PRESETS.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
            <div className="ns-row">
              <Button size="sm" variant="primary" type="submit">
                Create
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : null}

        {scenes.map((scene) => (
          <div
            key={scene.id}
            className={['ns-scene-row', scene.id === activeSceneId ? 'is-active' : '']
              .filter(Boolean)
              .join(' ')}
            onClick={() => selectSceneAction(scene.id)}
            onDoubleClick={() => {
              setRenamingId(scene.id);
              setRenameDraft(scene.name);
            }}
          >
            {renamingId === scene.id ? (
              <input
                className="ns-layer-rename"
                autoFocus
                value={renameDraft}
                onChange={(event) => setRenameDraft(event.target.value)}
                onClick={(event) => event.stopPropagation()}
                onBlur={() => {
                  renameSceneAction(scene.id, renameDraft);
                  setRenamingId(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                  if (event.key === 'Escape') setRenamingId(null);
                }}
              />
            ) : (
              <span className="ns-scene-name">{scene.name}</span>
            )}
            {scene.id === programSceneId ? <span className="ns-badge-program">PROGRAM</span> : null}
            <span className="ns-layer-tools" onClick={(event) => event.stopPropagation()}>
              <IconButton
                icon={ICONS.program}
                label="Set as program scene"
                size={13}
                onClick={() => void setProgramScene(scene.id)}
              />
            </span>
          </div>
        ))}

        <div className="ns-lib-group">
          <h3>Starter compositions</h3>
          {TEMPLATES.map((template) => (
            <button
              key={template.id}
              type="button"
              className="ns-lib-item"
              title={template.description}
              onClick={() => addTemplateScene(template.build)}
            >
              <span className="ns-lib-icon">
                <svg viewBox="0 0 24 24" width={13} height={13} aria-hidden="true">
                  <path
                    d="M4 5h16v14H4zM4 10h16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.7}
                  />
                </svg>
              </span>
              <span className="ns-scene-name">{template.name}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
