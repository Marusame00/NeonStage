import { useState, type ReactNode } from 'react';
import type { FieldSpec } from '../../../widgets/contract';
import type { SceneNode } from '../../../shared/model';
import { moveNodes } from '../../../shared/ops';
import { getWidget } from '../../../widgets/registry';
import {
  alignSelection,
  deleteNodes,
  distributeSelection,
  groupSelection,
  openSettings,
  patchNode,
  patchProps,
  setNodeRectAction,
  ungroupSelection,
  updateSceneDoc,
} from '../../state/actions';
import { selectScene, useEditor, type EditorState } from '../../state/store';
import { Button } from '../../ui/Button';
import { IconButton } from '../../ui/IconButton';
import { NumberField } from '../../ui/NumberField';
import { Section } from '../../ui/Section';
import { Slider } from '../../ui/Slider';
import { Toggle } from '../../ui/Toggle';
import { FieldControl } from './FieldControl';
import { ObsPlacementSection } from './ObsPlacementSection';
import { SceneSettings } from './SceneSettings';
import { StyleSections } from './StyleSections';

const selectInspector = (state: EditorState) => ({
  scene: selectScene(state),
  selection: state.selection,
});

const ALIGN_BUTTONS: { mode: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'; icon: string; label: string }[] = [
  { mode: 'left', icon: 'M4 3v18M8 7h9v4H8zM8 14h6v4H8z', label: 'Align left' },
  { mode: 'hcenter', icon: 'M12 3v18M7 7h10v4H7zM9 14h6v4H9z', label: 'Align horizontal center' },
  { mode: 'right', icon: 'M20 3v18M7 7h9v4H7zM10 14h6v4h-6z', label: 'Align right' },
  { mode: 'top', icon: 'M3 4h18M7 8h4v9H7zM14 8h4v6h-4z', label: 'Align top' },
  { mode: 'vcenter', icon: 'M3 12h18M7 7h4v10H7zM14 9h4v6h-4z', label: 'Align vertical center' },
  { mode: 'bottom', icon: 'M3 20h18M7 7h4v9H7zM14 10h4v6h-4z', label: 'Align bottom' },
];

export function Inspector(): ReactNode {
  const { scene, selection } = useEditor(selectInspector);
  const nodes = selection
    .map((id) => scene.nodes[id])
    .filter((node): node is SceneNode => node !== undefined);

  if (nodes.length === 0) return <SceneSettings />;
  if (nodes.length > 1) return <MultiInspector nodes={nodes} />;
  const node = nodes[0]!;
  return node.type === 'group' ? (
    <GroupInspector node={node} sceneWidth={scene.width} sceneHeight={scene.height} />
  ) : (
    <WidgetInspector node={node} sceneWidth={scene.width} sceneHeight={scene.height} />
  );
}

function WidgetInspector({
  node,
  sceneWidth,
  sceneHeight,
}: {
  node: SceneNode;
  sceneWidth: number;
  sceneHeight: number;
}): ReactNode {
  const definition = node.widget ? getWidget(node.widget.kind) : undefined;
  const props = node.widget?.props ?? {};
  const [lockAspect, setLockAspect] = useState(false);
  const ratio = node.w / Math.max(1, node.h);

  const setX = (value: number): void =>
    updateSceneDoc((scene) => moveNodes(scene, [node.id], value - node.x, 0), `${node.id}:x`);
  const setY = (value: number): void =>
    updateSceneDoc((scene) => moveNodes(scene, [node.id], 0, value - node.y), `${node.id}:y`);
  const setW = (value: number): void =>
    setNodeRectAction(
      node.id,
      { x: node.x, y: node.y, w: value, h: lockAspect ? value / ratio : node.h },
      `${node.id}:w`,
    );
  const setH = (value: number): void =>
    setNodeRectAction(
      node.id,
      { x: node.x, y: node.y, w: lockAspect ? value * ratio : node.w, h: value },
      `${node.id}:h`,
    );

  const sections = new Map<string, FieldSpec[]>();
  for (const field of definition?.fields ?? []) {
    if (!isVisible(field, props)) continue;
    const key = field.section ?? 'Widget';
    const list = sections.get(key) ?? [];
    list.push(field);
    sections.set(key, list);
  }

  return (
    <>
      <div className="ns-row" style={{ padding: '10px 0 6px' }}>
        <span className="ns-lib-icon">
          <svg viewBox="0 0 24 24" width={14} height={14} aria-hidden="true">
            <path
              d={definition?.icon ?? 'M4 5h16v14H4z'}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.7}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="ns-hint">{definition?.name ?? 'Unknown widget'}</div>
          <input
            className="ns-textinput"
            value={node.name}
            onChange={(event) => patchNode(node.id, { name: event.target.value }, `${node.id}:name`)}
          />
        </div>
        <Button size="sm" variant="danger" onClick={() => deleteNodes([node.id])}>
          Delete
        </Button>
      </div>

      <Section title="Transform">
        <div className="ns-grid-2">
          <NumberField label="X" value={Math.round(node.x)} onChange={setX} />
          <NumberField label="Y" value={Math.round(node.y)} onChange={setY} />
          <NumberField label="W" value={Math.round(node.w)} min={4} onChange={setW} />
          <NumberField label="H" value={Math.round(node.h)} min={4} onChange={setH} />
        </div>
        <Toggle label="Lock aspect ratio" checked={lockAspect} onChange={setLockAspect} />
        <Slider
          label="Opacity"
          value={Math.round(node.opacity * 100)}
          min={0}
          max={100}
          unit="%"
          onChange={(value) => patchNode(node.id, { opacity: value / 100 }, `${node.id}:opacity`)}
        />
        <div className="ns-row">
          <Toggle
            label="Visible"
            checked={node.visible}
            onChange={(value) => patchNode(node.id, { visible: value })}
          />
          <Toggle
            label="Locked"
            checked={node.locked}
            onChange={(value) => patchNode(node.id, { locked: value })}
          />
        </div>
      </Section>

      <ObsPlacementSection node={node} sceneWidth={sceneWidth} sceneHeight={sceneHeight} />

      <Section title="Output" defaultOpen={false}>
        <NumberField
          label="Padding"
          value={node.output.padding}
          min={0}
          max={400}
          unit="px"
          onChange={(value) =>
            patchNode(node.id, { output: { ...node.output, padding: value } }, `${node.id}:padding`)
          }
        />
        <p className="ns-hint">
          Extra transparent space around this object&apos;s own output URL (shadows/glows are already
          included).
        </p>
      </Section>

      {definition?.manualLabel ? (
        <div className="ns-callout is-info" style={{ margin: '8px 0' }}>
          <strong>Manually controlled</strong> — update it from the Stream controls panel. Not
          connected to donations, subscriptions or followers.
        </div>
      ) : null}

      {props.source === 'demo' ? (
        <div className="ns-callout is-info" style={{ margin: '8px 0' }}>
          Demo mode shows sample messages for layout design. It is not a live connection and is
          hidden in OBS unless &apos;Show demo in output&apos; is on.
        </div>
      ) : null}

      {props.source === 'live' ? (
        <div className="ns-row" style={{ margin: '8px 0' }}>
          <Button size="sm" onClick={() => openSettings('connections')}>
            Set up connections
          </Button>
        </div>
      ) : null}

      {definition?.notes?.map((note) => (
        <div key={note} className="ns-callout" style={{ margin: '8px 0' }}>
          {note}
        </div>
      ))}

      {[...sections.entries()].map(([title, fields]) => (
        <Section key={title} title={title}>
          {fields.map((field) => (
            <FieldControl
              key={field.key}
              field={field}
              value={props[field.key]}
              onChange={(value) =>
                patchProps(node.id, { [field.key]: value }, `${node.id}:${field.key}`)
              }
            />
          ))}
        </Section>
      ))}

      <StyleSections nodes={[node]} />
    </>
  );
}

function GroupInspector({
  node,
  sceneWidth,
  sceneHeight,
}: {
  node: SceneNode;
  sceneWidth: number;
  sceneHeight: number;
}): ReactNode {
  const setX = (value: number): void =>
    updateSceneDoc((scene) => moveNodes(scene, [node.id], value - node.x, 0), `${node.id}:x`);
  const setY = (value: number): void =>
    updateSceneDoc((scene) => moveNodes(scene, [node.id], 0, value - node.y), `${node.id}:y`);

  return (
    <>
      <div className="ns-row" style={{ padding: '10px 0 6px' }}>
        <span className="ns-lib-icon">
          <svg viewBox="0 0 24 24" width={14} height={14} aria-hidden="true">
            <path
              d="M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h6v6h-6z"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.7}
            />
          </svg>
        </span>
        <input
          className="ns-textinput"
          value={node.name}
          onChange={(event) => patchNode(node.id, { name: event.target.value }, `${node.id}:name`)}
        />
        <Button size="sm" variant="danger" onClick={() => deleteNodes([node.id])}>
          Delete
        </Button>
      </div>

      <Section title="Group">
        <div className="ns-grid-2">
          <NumberField label="X" value={Math.round(node.x)} onChange={setX} />
          <NumberField label="Y" value={Math.round(node.y)} onChange={setY} />
          <NumberField
            label="W"
            value={Math.round(node.w)}
            min={4}
            onChange={(value) => setNodeRectAction(node.id, { x: node.x, y: node.y, w: value, h: node.h }, `${node.id}:w`)}
          />
          <NumberField
            label="H"
            value={Math.round(node.h)}
            min={4}
            onChange={(value) => setNodeRectAction(node.id, { x: node.x, y: node.y, w: node.w, h: value }, `${node.id}:h`)}
          />
        </div>
        <p className="ns-hint">Resizing a group rescales its arrangement.</p>
        <Slider
          label="Opacity"
          value={Math.round(node.opacity * 100)}
          min={0}
          max={100}
          unit="%"
          onChange={(value) => patchNode(node.id, { opacity: value / 100 }, `${node.id}:opacity`)}
        />
        <Toggle
          label="Visible"
          checked={node.visible}
          onChange={(value) => patchNode(node.id, { visible: value })}
        />
        <p className="ns-hint">Hidden/opacity are inherited by children.</p>
        <NumberField
          label="Output padding"
          value={node.output.padding}
          min={0}
          max={400}
          unit="px"
          onChange={(value) =>
            patchNode(node.id, { output: { ...node.output, padding: value } }, `${node.id}:padding`)
          }
        />
        <Button size="sm" onClick={ungroupSelection}>
          Ungroup
        </Button>
      </Section>

      <ObsPlacementSection node={node} sceneWidth={sceneWidth} sceneHeight={sceneHeight} />
    </>
  );
}

function MultiInspector({ nodes }: { nodes: SceneNode[] }): ReactNode {
  const widgets = nodes.filter((node) => node.type === 'widget');
  return (
    <>
      <div className="ns-row" style={{ padding: '10px 0 6px' }}>
        <strong style={{ flex: 1 }}>{nodes.length} objects selected</strong>
        <Button size="sm" variant="danger" onClick={() => deleteNodes(nodes.map((node) => node.id))}>
          Delete
        </Button>
      </div>
      <Section title="Arrange">
        <div className="ns-row">
          {ALIGN_BUTTONS.map((entry) => (
            <IconButton
              key={entry.mode}
              icon={entry.icon}
              label={entry.label}
              onClick={() => alignSelection(entry.mode)}
            />
          ))}
        </div>
        <div className="ns-row">
          <Button size="sm" disabled={nodes.length < 3} onClick={() => distributeSelection('h')}>
            Distribute H
          </Button>
          <Button size="sm" disabled={nodes.length < 3} onClick={() => distributeSelection('v')}>
            Distribute V
          </Button>
        </div>
        <Button size="sm" variant="primary" onClick={groupSelection}>
          Group
        </Button>
      </Section>
      {widgets.length > 0 ? <StyleSections nodes={widgets} /> : null}
    </>
  );
}

function isVisible(field: FieldSpec, props: Record<string, unknown>): boolean {
  if (!field.showIf) return true;
  const value = props[field.showIf.key];
  const expected = field.showIf.equals;
  return Array.isArray(expected) ? expected.includes(value) : value === expected;
}
