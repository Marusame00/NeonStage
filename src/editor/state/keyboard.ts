import { setLocked, setVisible } from '../../shared/ops';
import {
  clearSelection,
  deleteSelection,
  duplicateSelection,
  exitGroup,
  fitView,
  groupSelection,
  nudgeSelection,
  publish,
  redo,
  reorderSelection,
  setSelection,
  setZoom,
  undo,
  ungroupSelection,
  updateSceneDoc,
  zoomAt,
} from './actions';
import { selectScene, store } from './store';

interface TypingLike {
  tagName?: unknown;
  isContentEditable?: unknown;
  type?: unknown;
  closest?: (selector: string) => unknown;
}

const TEXT_INPUT_TYPES = ['text', 'number', 'search', 'email', 'url', 'password', 'tel'];

export function isTypingTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false;
  const element = target as TypingLike;
  const tag = typeof element.tagName === 'string' ? element.tagName.toUpperCase() : '';
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = typeof element.type === 'string' ? element.type.toLowerCase() : '';
    if (type === '' || TEXT_INPUT_TYPES.includes(type)) return true;
  }
  if (element.isContentEditable === true) return true;
  if (typeof element.closest === 'function' && element.closest('[data-no-shortcuts]')) return true;
  return false;
}

function zoomStep(factor: number): void {
  const state = store.getState();
  zoomAt(state.zoom * factor, state.viewport.w / 2, state.viewport.h / 2);
}

function selectAll(): void {
  const state = store.getState();
  const scene = selectScene(state);
  const ids = state.enteredGroupId
    ? (scene.nodes[state.enteredGroupId]?.children ?? [])
    : scene.rootIds;
  setSelection([...ids]);
}

function toggleFlag(flag: 'visible' | 'locked'): void {
  const state = store.getState();
  if (state.selection.length === 0) return;
  const scene = selectScene(state);
  const allOn = state.selection.every((id) => scene.nodes[id]?.[flag] === true);
  updateSceneDoc((current) =>
    flag === 'visible'
      ? setVisible(current, state.selection, !allOn)
      : setLocked(current, state.selection, !allOn),
  );
}

function handle(event: KeyboardEvent): boolean {
  const key = event.key;
  const ctrl = event.ctrlKey || event.metaKey;
  const shift = event.shiftKey;
  const lower = key.toLowerCase();

  if (ctrl && lower === 'enter') {
    void publish();
    return true;
  }
  if (ctrl && !shift && lower === 'z') {
    undo();
    return true;
  }
  if ((ctrl && lower === 'y') || (ctrl && shift && lower === 'z')) {
    redo();
    return true;
  }
  if (ctrl && !shift && lower === 'd') {
    duplicateSelection();
    return true;
  }
  if (ctrl && !shift && lower === 'g') {
    groupSelection();
    return true;
  }
  if (ctrl && shift && lower === 'g') {
    ungroupSelection();
    return true;
  }
  if (ctrl && !shift && lower === 'a') {
    selectAll();
    return true;
  }
  if (ctrl && key === '0') {
    fitView();
    return true;
  }
  if (ctrl && key === '1') {
    setZoom(1);
    return true;
  }
  if (ctrl && (key === '=' || key === '+')) {
    zoomStep(1.2);
    return true;
  }
  if (ctrl && (key === '-' || key === '_')) {
    zoomStep(1 / 1.2);
    return true;
  }
  if (ctrl && (key === ']' || key === '}')) {
    reorderSelection(shift ? 'front' : 'forward');
    return true;
  }
  if (ctrl && (key === '[' || key === '{')) {
    reorderSelection(shift ? 'back' : 'backward');
    return true;
  }
  if (ctrl && shift && lower === 'h') {
    toggleFlag('visible');
    return true;
  }
  if (ctrl && shift && lower === 'l') {
    toggleFlag('locked');
    return true;
  }
  if (key === 'Delete' || key === 'Backspace') {
    deleteSelection();
    return true;
  }
  if (key === 'Escape') {
    const state = store.getState();
    if (state.selection.length > 0) clearSelection();
    else if (state.enteredGroupId) exitGroup();
    return true;
  }
  if (key.startsWith('Arrow')) {
    const step = shift ? 10 : 1;
    const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0;
    const dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0;
    nudgeSelection(dx, dy);
    return true;
  }
  return false;
}

export function installKeyboard(): () => void {
  const listener = (event: KeyboardEvent): void => {
    const target = event.target;
    if (isTypingTarget(target)) {
      if (event.key === 'Escape' && target instanceof HTMLElement) target.blur();
      return;
    }
    if (handle(event)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  window.addEventListener('keydown', listener);
  return () => window.removeEventListener('keydown', listener);
}
