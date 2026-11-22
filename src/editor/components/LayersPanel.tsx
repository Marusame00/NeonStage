import { useState, type DragEvent as ReactDragEvent, type ReactNode } from 'react';
import type { Scene } from '../../shared/model';
import { isEffectivelyVisible, moveNodeTo, setLocked, setVisible } from '../../shared/ops';
import { getWidget } from '../../widgets/registry';
import { deleteNodes, patchNode, setSelection, toggleSelected, updateSceneDoc } from '../state/actions';
import { selectScene, useEditor, type EditorState } from '../state/store';
import { IconButton } from '../ui/IconButton';

const selectLayers = (state: EditorState) => ({
  scene: selectScene(state),
  selection: state.selection,
  enteredGroupId: state.enteredGroupId,
});

const LAYER_MIME = 'application/x-neonstage-layer';

const ICONS = {
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  eyeOff:
    'M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3 3.9M6.6 6.6A17 17 0 0 0 2 12s4 7 10 7a10 10 0 0 0 4.1-.9',
  lock: 'M6 11h12v9H6zM9 11V8a3 3 0 0 1 6 0v3',
  unlock: 'M6 11h12v9H6zM9 11V8a3 3 0 0 1 5.6-1.5',
  chevronDown: 'M6 9l6 6 6-6',
  chevronRight: 'M9 6l6 6-6 6',
  remove: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  group: 'M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h6v6h-6z',
};

interface Row {
  id: string;
  depth: number;
}

function listOf(scene: Scene, parentId: string | null): string[] {
  return parentId ? (scene.nodes[parentId]?.children ?? []) : scene.rootIds;
}

function buildRows(scene: Scene, parentId: string | null, depth: number, collapsed: Set<string>): Row[] {
  const rows: Row[] = [];
  for (const id of [...listOf(scene, parentId)].reverse()) {
    const node = scene.nodes[id];
    if (!node) continue;
    rows.push({ id, depth });
    if (node.type === 'group' && !collapsed.has(id)) {
      rows.push(...buildRows(scene, id, depth + 1, collapsed));
    }
  }
  return rows;
}

type DropPosition = 'before' | 'after' | 'into';

export function LayersPanel(): ReactNode {
  const { scene, selection } = useEditor(selectLayers);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [drop, setDrop] = useState<{ id: string; position: DropPosition } | null>(null);
  const rows = buildRows(scene, null, 0, collapsed);

  const onDrop = (event: ReactDragEvent<HTMLDivElement>, targetId: string, position: DropPosition): void => {
    event.preventDefault();
    event.stopPropagation();
    setDrop(null);
    const draggedId = event.dataTransfer.getData(LAYER_MIME);
    if (!draggedId || draggedId === targetId) return;
    const target = scene.nodes[targetId];
    if (!target) return;
    if (position === 'into') {
      if (target.type !== 'group') return;
      const list = listOf(scene, target.id).filter((id) => id !== draggedId);
      updateSceneDoc((current) => moveNodeTo(current, draggedId, target.id, list.length));
      return;
    }
    const parentId = target.parentId;
    const list = listOf(scene, parentId).filter((id) => id !== draggedId);
    const index = list.indexOf(targetId);
    if (index < 0) return;
    updateSceneDoc((current) =>
      moveNodeTo(current, draggedId, parentId, position === 'after' ? index + 1 : index),
    );
  };

  return (
    <section className="ns-panel ns-layers">
      <header className="ns-panel-head">
        <h2>Layers</h2>
        <span className="ns-hint">{rows.length}</span>
      </header>
      <div className="ns-panel-body" style={{ padding: '0 6px 8px' }}>
        {rows.length === 0 ? <div className="ns-empty">This scene is empty.</div> : null}
        {rows.map((row) => {
          const node = scene.nodes[row.id];
          if (!node) return null;
          const definition = node.widget ? getWidget(node.widget.kind) : undefined;
          const inheritedHidden = node.visible && !isEffectivelyVisible(scene, row.id);
          const isDrop = drop?.id === row.id ? drop.position : null;
          return (
            <div
              key={row.id}
              className={[
                'ns-layer-row',
                selection.includes(row.id) ? 'is-selected' : '',
                inheritedHidden ? 'is-dim' : '',
                isDrop === 'before' ? 'is-drop-before' : '',
                isDrop === 'after' ? 'is-drop-after' : '',
                isDrop === 'into' ? 'is-drop-into' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{ paddingLeft: 2 + row.depth * 12 }}
              title={inheritedHidden ? 'Hidden because parent group is hidden' : node.name}
              draggable={renamingId !== row.id}
              onDragStart={(event) => {
                event.dataTransfer.setData(LAYER_MIME, row.id);
                event.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(event) => {
                if (!event.dataTransfer.types.includes(LAYER_MIME)) return;
                event.preventDefault();
                const rect = event.currentTarget.getBoundingClientRect();
                const ratio = (event.clientY - rect.top) / rect.height;
                const position: DropPosition =
                  node.type === 'group' && ratio > 0.3 && ratio < 0.7
                    ? 'into'
                    : ratio < 0.5
                      ? 'before'
                      : 'after';
                setDrop({ id: row.id, position });
              }}
              onDragLeave={() => setDrop((current) => (current?.id === row.id ? null : current))}
              onDrop={(event) => onDrop(event, row.id, drop?.id === row.id ? drop.position : 'after')}
              onClick={(event) => {
                if (event.shiftKey) {
                  const last = selection[selection.length - 1];
                  const siblings = listOf(scene, node.parentId);
                  const from = last ? siblings.indexOf(last) : -1;
                  const to = siblings.indexOf(row.id);
                  if (from >= 0 && to >= 0) {
                    const [start, end] = from < to ? [from, to] : [to, from];
                    setSelection(siblings.slice(start, end + 1));
                    return;
                  }
                }
                if (event.ctrlKey || event.metaKey) {
                  toggleSelected(row.id);
                  return;
                }
                setSelection([row.id]);
              }}
              onDoubleClick={() => {
                setRenamingId(row.id);
                setRenameDraft(node.name);
              }}
            >
              {node.type === 'group' ? (
                <IconButton
                  icon={collapsed.has(row.id) ? ICONS.chevronRight : ICONS.chevronDown}
                  label={collapsed.has(row.id) ? 'Expand group' : 'Collapse group'}
                  size={12}
                  onClick={(event) => {
                    event.stopPropagation();
                    setCollapsed((current) => {
                      const next = new Set(current);
                      if (next.has(row.id)) next.delete(row.id);
                      else next.add(row.id);
                      return next;
                    });
                  }}
                />
              ) : (
                <span style={{ width: 24, flex: 'none' }} />
              )}
              <span className="ns-lib-icon" style={{ width: 16, height: 16 }}>
                <svg viewBox="0 0 24 24" width={11} height={11} aria-hidden="true">
                  <path
                    d={node.type === 'group' ? ICONS.group : (definition?.icon ?? 'M4 5h16v14H4z')}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.8}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              {renamingId === row.id ? (
                <input
                  className="ns-layer-rename"
                  autoFocus
                  value={renameDraft}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => setRenameDraft(event.target.value)}
                  onBlur={() => {
                    const next = renameDraft.trim();
                    if (next && next !== node.name) patchNode(row.id, { name: next });
                    setRenamingId(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                    if (event.key === 'Escape') setRenamingId(null);
                  }}
                />
              ) : (
                <span className="ns-layer-name">{node.name}</span>
              )}
              <span className="ns-layer-tools" onClick={(event) => event.stopPropagation()}>
                <IconButton
                  icon={node.visible ? ICONS.eye : ICONS.eyeOff}
                  label={node.visible ? 'Hide' : 'Show'}
                  size={13}
                  onClick={() => updateSceneDoc((current) => setVisible(current, [row.id], !node.visible))}
                />
                <IconButton
                  icon={node.locked ? ICONS.lock : ICONS.unlock}
                  label={node.locked ? 'Unlock' : 'Lock'}
                  size={13}
                  active={node.locked}
                  onClick={() => updateSceneDoc((current) => setLocked(current, [row.id], !node.locked))}
                />
                <IconButton
                  icon={ICONS.remove}
                  label="Delete layer"
                  size={13}
                  onClick={() => deleteNodes([row.id])}
                />
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
