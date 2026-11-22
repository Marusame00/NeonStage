import { useMemo, type ReactNode } from 'react';
import { listWidgets } from '../../widgets/registry';
import type { WidgetCategory, WidgetDefinition } from '../../widgets/contract';
import { addWidget } from '../state/actions';
import { selectScene, useEditor, type EditorState } from '../state/store';

const selectSceneSize = (state: EditorState) => {
  const scene = selectScene(state);
  return { width: scene.width, height: scene.height };
};

const CATEGORY_LABELS: Record<WidgetCategory, string> = {
  text: 'Text',
  shape: 'Shapes',
  frame: 'Frames',
  time: 'Time',
  progress: 'Progress',
  chat: 'Chat',
  info: 'Info',
  media: 'Media',
};

const CATEGORY_ORDER: WidgetCategory[] = [
  'text',
  'shape',
  'frame',
  'time',
  'progress',
  'chat',
  'info',
  'media',
];

export const WIDGET_MIME = 'application/x-neonstage-widget';

export function LibraryPanel(): ReactNode {
  const { width, height } = useEditor(selectSceneSize);
  const groups = useMemo(() => {
    const widgets = listWidgets();
    return CATEGORY_ORDER.map((category) => ({
      category,
      items: widgets.filter((widget) => widget.category === category),
    })).filter((group) => group.items.length > 0);
  }, []);

  return (
    <section className="ns-panel" style={{ flex: '1 1 auto' }}>
      <header className="ns-panel-head">
        <h2>Library</h2>
      </header>
      <div className="ns-panel-body">
        {groups.map((group) => (
          <div key={group.category} className="ns-lib-group">
            <h3>{CATEGORY_LABELS[group.category]}</h3>
            {group.items.map((widget) => (
              <LibraryItem
                key={widget.kind}
                widget={widget}
                onAdd={() => addWidget(widget.kind, width / 2, height / 2)}
              />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function LibraryItem({
  widget,
  onAdd,
}: {
  widget: WidgetDefinition<Record<string, unknown>>;
  onAdd(): void;
}): ReactNode {
  return (
    <button
      type="button"
      className="ns-lib-item"
      title={widget.description}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(WIDGET_MIME, widget.kind);
        event.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={onAdd}
    >
      <span className="ns-lib-icon">
        <svg viewBox="0 0 24 24" width={14} height={14} aria-hidden="true">
          <path
            d={widget.icon}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.7}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className="ns-scene-name">{widget.name}</span>
    </button>
  );
}
