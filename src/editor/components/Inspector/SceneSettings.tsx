import { useState, type ReactNode } from 'react';
import { CANVAS_PRESETS } from '../../../shared/model';
import { renameScene, type SceneSizeMode } from '../../../shared/ops';
import { setReduceMotion, setSceneSizeAction, updateDoc } from '../../state/actions';
import { selectScene, useEditor, type EditorState } from '../../state/store';
import { NumberField } from '../../ui/NumberField';
import { Section } from '../../ui/Section';
import { Select } from '../../ui/Select';
import { Toggle } from '../../ui/Toggle';

const selectSceneSettings = (state: EditorState) => ({
  scene: selectScene(state),
  reduceMotion: state.doc.settings.reduceMotion,
});

export function SceneSettings(): ReactNode {
  const { scene, reduceMotion } = useEditor(selectSceneSettings);
  const [mode, setMode] = useState<SceneSizeMode>('keep');
  const preset =
    CANVAS_PRESETS.find((entry) => entry.width === scene.width && entry.height === scene.height)?.id ??
    'custom';

  return (
    <>
      <Section title="Scene">
        <label className="ns-field">
          <span className="ns-field-label">Name</span>
          <input
            className="ns-textinput"
            value={scene.name}
            onChange={(event) =>
              updateDoc(
                (doc) => renameScene(doc, scene.id, event.target.value),
                `${scene.id}:name`,
              )
            }
          />
        </label>
        <Select
          label="Canvas preset"
          value={preset}
          options={[
            ...CANVAS_PRESETS.map((entry) => ({ value: entry.id, label: entry.label })),
            { value: 'custom', label: 'Custom' },
          ]}
          onChange={(value) => {
            const next = CANVAS_PRESETS.find((entry) => entry.id === value);
            if (next) setSceneSizeAction(next.width, next.height, mode);
          }}
        />
        <div className="ns-grid-2">
          <NumberField
            label="Width"
            value={scene.width}
            min={16}
            max={7680}
            unit="px"
            onChange={(value) => setSceneSizeAction(value, scene.height, mode)}
          />
          <NumberField
            label="Height"
            value={scene.height}
            min={16}
            max={4320}
            unit="px"
            onChange={(value) => setSceneSizeAction(scene.width, value, mode)}
          />
        </div>
        <div className="ns-field">
          <span className="ns-field-label">When changing size</span>
          <label className="ns-toggle">
            <input
              type="radio"
              name="ns-size-mode"
              checked={mode === 'keep'}
              onChange={() => setMode('keep')}
            />
            <span className="ns-toggle-label">Keep objects where they are</span>
          </label>
          <label className="ns-toggle">
            <input
              type="radio"
              name="ns-size-mode"
              checked={mode === 'scale'}
              onChange={() => setMode('scale')}
            />
            <span className="ns-toggle-label">Scale composition to fit</span>
          </label>
        </div>
        <p className="ns-hint">
          Scaling the composition uniformly resizes every object, font and stroke. Resizing a single
          widget instead lets its content reflow (text wraps, chat shows more lines) without
          stretching.
        </p>
      </Section>

      <Section title="Project">
        <Toggle
          label="Reduce motion in output"
          checked={reduceMotion}
          onChange={setReduceMotion}
        />
        <p className="ns-hint">
          Disables ticker scrolling, chat entry animations and pulsing glows in OBS and the preview.
        </p>
      </Section>
    </>
  );
}
