import { useState, type ReactNode } from 'react';
import {
  alignSelection,
  deleteSelection,
  distributeSelection,
  duplicateSelection,
  fitView,
  groupSelection,
  patchPrefs,
  redo,
  reorderSelection,
  setOutputPreview,
  setZoom,
  undo,
  ungroupSelection,
  zoomAt,
} from '../../state/actions';
import { useEditor, type EditorState } from '../../state/store';
import { IconButton } from '../../ui/IconButton';

const selectPrefs = (state: EditorState) => state.prefs;
const selectZoom = (state: EditorState) => state.zoom;
const selectSelection = (state: EditorState) => state.selection;
const selectPreview = (state: EditorState) => state.outputPreview;
const selectViewport = (state: EditorState) => state.viewport;
const selectHistoryDepth = (state: EditorState) => state.historyDepth;

const ICONS = {
  undo: 'M9 14L4 9l5-5M4 9h9a7 7 0 0 1 0 14h-3',
  redo: 'M15 14l5-5-5-5M20 9h-9a7 7 0 0 0 0 14h3',
  snap: 'M12 3v6M12 15v6M3 12h6M15 12h6',
  grid: 'M3 9h18M3 15h18M9 3v18M15 3v18',
  alignLeft: 'M4 3v18M8 7h9v4H8zM8 14h6v4H8z',
  alignHCenter: 'M12 3v18M7 7h10v4H7zM9 14h6v4H9z',
  alignRight: 'M20 3v18M7 7h9v4H7zM10 14h6v4h-6z',
  alignTop: 'M3 4h18M7 8h4v9H7zM14 8h4v6h-4z',
  alignVCenter: 'M3 12h18M7 7h4v10H7zM14 9h4v6h-4z',
  alignBottom: 'M3 20h18M7 7h4v9H7zM14 10h4v6h-4z',
  distributeH: 'M4 3v18M20 3v18M10 7h4v10h-4z',
  distributeV: 'M3 4h18M3 20h18M7 10h10v4H7z',
  group: 'M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h6v6h-6z',
  ungroup: 'M3 3h6v6H3zM15 15h6v6h-6zM12 8v8M8 12h8',
  forward: 'M12 4l6 6h-4v10h-4V10H6z',
  backward: 'M12 20l-6-6h4V4h4v10h4z',
  duplicate: 'M8 8h12v12H8zM4 16V4h12',
  remove: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  preview: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  help: 'M12 17h.01M9.1 9a3 3 0 1 1 4.5 2.6c-.9.5-1.6 1.2-1.6 2.4',
  minus: 'M5 12h14',
  plus: 'M12 5v14M5 12h14',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
};

const SHORTCUTS: [string, string][] = [
  ['Del', 'Delete selection'],
  ['Ctrl+D', 'Duplicate'],
  ['Ctrl+G', 'Group'],
  ['Ctrl+Shift+G', 'Ungroup'],
  ['Ctrl+Z', 'Undo'],
  ['Ctrl+Y', 'Redo'],
  ['Arrows', 'Nudge 1 px (Shift 10 px)'],
  ['Ctrl+A', 'Select all'],
  ['Esc', 'Clear selection / exit group'],
  ['Ctrl+0', 'Fit to view'],
  ['Ctrl+1', 'Zoom 100%'],
  ['Ctrl+= / -', 'Zoom in / out'],
  ['Ctrl+] / [', 'Forward / backward'],
  ['Ctrl+Shift+] / [', 'Bring to front / send to back'],
  ['Ctrl+Shift+H', 'Toggle visibility'],
  ['Ctrl+Shift+L', 'Toggle lock'],
  ['Ctrl+Enter', 'Publish to OBS'],
];

export function CanvasToolbar(): ReactNode {
  const prefs = useEditor(selectPrefs);
  const zoom = useEditor(selectZoom);
  const selection = useEditor(selectSelection);
  const outputPreview = useEditor(selectPreview);
  const viewport = useEditor(selectViewport);
  const historyDepth = useEditor(selectHistoryDepth);
  const [editingZoom, setEditingZoom] = useState(false);
  const [zoomDraft, setZoomDraft] = useState('100');
  const [showShortcuts, setShowShortcuts] = useState(false);
  const hasSelection = selection.length > 0;

  return (
    <div
      className="ns-canvas-toolbar"
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <IconButton
        icon={ICONS.undo}
        label="Undo (Ctrl+Z)"
        disabled={historyDepth.past === 0}
        onClick={undo}
      />
      <IconButton
        icon={ICONS.redo}
        label="Redo (Ctrl+Y)"
        disabled={historyDepth.future === 0}
        onClick={redo}
      />
      <span className="ns-toolbar-sep" />
      <IconButton
        icon={ICONS.snap}
        label="Snap to objects and canvas"
        active={prefs.editor.snap}
        onClick={() => void patchPrefs({ editor: { snap: !prefs.editor.snap } })}
      />
      <IconButton
        icon={ICONS.grid}
        label="Show grid"
        active={prefs.editor.showGrid}
        onClick={() => void patchPrefs({ editor: { showGrid: !prefs.editor.showGrid } })}
      />
      <span className="ns-toolbar-sep" />
      <IconButton icon={ICONS.alignLeft} label="Align left" disabled={!hasSelection} onClick={() => alignSelection('left')} />
      <IconButton icon={ICONS.alignHCenter} label="Align horizontal center" disabled={!hasSelection} onClick={() => alignSelection('hcenter')} />
      <IconButton icon={ICONS.alignRight} label="Align right" disabled={!hasSelection} onClick={() => alignSelection('right')} />
      <IconButton icon={ICONS.alignTop} label="Align top" disabled={!hasSelection} onClick={() => alignSelection('top')} />
      <IconButton icon={ICONS.alignVCenter} label="Align vertical center" disabled={!hasSelection} onClick={() => alignSelection('vcenter')} />
      <IconButton icon={ICONS.alignBottom} label="Align bottom" disabled={!hasSelection} onClick={() => alignSelection('bottom')} />
      <IconButton icon={ICONS.distributeH} label="Distribute horizontally" disabled={selection.length < 3} onClick={() => distributeSelection('h')} />
      <IconButton icon={ICONS.distributeV} label="Distribute vertically" disabled={selection.length < 3} onClick={() => distributeSelection('v')} />
      <span className="ns-toolbar-sep" />
      <IconButton icon={ICONS.group} label="Group (Ctrl+G)" disabled={selection.length < 2} onClick={groupSelection} />
      <IconButton icon={ICONS.ungroup} label="Ungroup (Ctrl+Shift+G)" disabled={!hasSelection} onClick={ungroupSelection} />
      <IconButton icon={ICONS.forward} label="Bring forward (Ctrl+])" disabled={!hasSelection} onClick={() => reorderSelection('forward')} />
      <IconButton icon={ICONS.backward} label="Send backward (Ctrl+[)" disabled={!hasSelection} onClick={() => reorderSelection('backward')} />
      <IconButton icon={ICONS.duplicate} label="Duplicate (Ctrl+D)" disabled={!hasSelection} onClick={duplicateSelection} />
      <IconButton icon={ICONS.remove} label="Delete (Del)" disabled={!hasSelection} onClick={deleteSelection} />
      <span className="ns-toolbar-sep" />
      <IconButton
        icon={ICONS.preview}
        label="Show as OBS sees it"
        active={outputPreview}
        onClick={() => setOutputPreview(!outputPreview)}
      />
      <IconButton icon={ICONS.help} label="Keyboard shortcuts" active={showShortcuts} onClick={() => setShowShortcuts(!showShortcuts)} />
      <span className="ns-toolbar-sep" />
      <IconButton
        icon={ICONS.minus}
        label="Zoom out (Ctrl+-)"
        onClick={() => zoomAt(zoom / 1.2, viewport.w / 2, viewport.h / 2)}
      />
      {editingZoom ? (
        <input
          className="ns-zoom-input"
          autoFocus
          value={zoomDraft}
          onChange={(event) => setZoomDraft(event.target.value)}
          onBlur={() => {
            const parsed = Number(zoomDraft.replace('%', ''));
            if (Number.isFinite(parsed) && parsed > 0) setZoom(parsed / 100);
            setEditingZoom(false);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') setEditingZoom(false);
          }}
        />
      ) : (
        <button
          type="button"
          className="ns-zoom-readout"
          title="Click to type a zoom level"
          onClick={() => {
            setZoomDraft(String(Math.round(zoom * 100)));
            setEditingZoom(true);
          }}
        >
          {Math.round(zoom * 100)}%
        </button>
      )}
      <IconButton
        icon={ICONS.plus}
        label="Zoom in (Ctrl+=)"
        onClick={() => zoomAt(zoom * 1.2, viewport.w / 2, viewport.h / 2)}
      />
      <IconButton icon={ICONS.fit} label="Fit (Ctrl+0)" onClick={fitView} />
      <button type="button" className="ns-btn ns-btn-ghost ns-btn-sm" onClick={() => setZoom(1)}>
        100%
      </button>

      {showShortcuts ? (
        <div className="ns-menu" style={{ top: 'calc(100% + 6px)', left: 'auto', right: 0, minWidth: 300 }}>
          <div className="ns-menu-title">Keyboard shortcuts</div>
          <div className="ns-shortcuts" style={{ padding: '4px 8px 8px' }}>
            {SHORTCUTS.map(([keys, label]) => (
              <ShortcutRow key={keys} keys={keys} label={label} />
            ))}
          </div>
          <button
            type="button"
            className="ns-menu-item"
            onClick={() => setShowShortcuts(false)}
          >
            Close
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ShortcutRow({ keys, label }: { keys: string; label: string }): ReactNode {
  return (
    <>
      <kbd>{keys}</kbd>
      <span>{label}</span>
    </>
  );
}
