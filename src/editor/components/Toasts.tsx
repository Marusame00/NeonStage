import type { ReactNode } from 'react';
import { dismissNotice } from '../state/actions';
import { useEditor, type EditorState } from '../state/store';

const selectNotices = (state: EditorState) => state.notices;

export function Toasts(): ReactNode {
  const notices = useEditor(selectNotices);
  if (notices.length === 0) return null;
  return (
    <div className="ns-toasts">
      {notices.map((notice) => (
        <div
          key={notice.id}
          className={['ns-toast', `is-${notice.level}`].join(' ')}
          role="status"
        >
          <span>{notice.message}</span>
          <button type="button" onClick={() => dismissNotice(notice.id)} aria-label="Dismiss">
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
