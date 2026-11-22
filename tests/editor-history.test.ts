import { describe, expect, it } from 'vitest';
import { createEmptyProject, type ProjectDoc } from '../src/shared/model';
import {
  COALESCE_MS,
  HISTORY_LIMIT,
  beginTransient,
  commit,
  createHistory,
  endTransient,
  redo,
  transient,
  undo,
} from '../src/editor/state/history';

function doc(name: string): ProjectDoc {
  return createEmptyProject(name);
}

describe('editor history', () => {
  it('commits, undoes and redoes document snapshots', () => {
    const a = doc('a');
    const b = doc('b');
    let history = createHistory();
    history = commit(history, a, b, null, 0);
    expect(history.past).toHaveLength(1);
    expect(history.past[0]!.doc).toBe(a);

    const undone = undo(history, b);
    expect(undone).not.toBeNull();
    expect(undone!.doc).toBe(a);
    expect(undone!.history.future).toEqual([b]);
    expect(undone!.history.past).toHaveLength(0);

    const redone = redo(undone!.history, a, 10);
    expect(redone).not.toBeNull();
    expect(redone!.doc).toBe(b);
    expect(redone!.history.past).toHaveLength(1);
    expect(redo(redone!.history, b, 20)).toBeNull();
  });

  it('ignores commits that do not change the document', () => {
    const a = doc('a');
    const history = createHistory();
    expect(commit(history, a, a, null, 0)).toBe(history);
  });

  it('merges consecutive commits with the same key inside the window', () => {
    const a = doc('a');
    const b = doc('b');
    const c = doc('c');
    const d = doc('d');
    let history = createHistory();
    history = commit(history, a, b, 'node:text', 1000);
    history = commit(history, b, c, 'node:text', 1000 + COALESCE_MS);
    expect(history.past).toHaveLength(1);
    expect(history.past[0]!.doc).toBe(a);

    history = commit(history, c, d, 'node:text', 1000 + COALESCE_MS * 2 + 1);
    expect(history.past).toHaveLength(2);
    expect(history.past[1]!.doc).toBe(c);
  });

  it('does not merge different keys', () => {
    const a = doc('a');
    const b = doc('b');
    const c = doc('c');
    let history = createHistory();
    history = commit(history, a, b, 'one', 0);
    history = commit(history, b, c, 'two', 1);
    expect(history.past).toHaveLength(2);
  });

  it('records a transient drag as exactly one entry', () => {
    const a = doc('a');
    const b = doc('b');
    const c = doc('c');
    const history = createHistory();
    let drag = beginTransient(a);
    drag = transient(drag, b);
    drag = transient(drag, c);
    const result = endTransient(drag, history, 0);
    expect(result.changed).toBe(true);
    expect(result.history.past).toHaveLength(1);
    expect(result.history.past[0]!.doc).toBe(a);
  });

  it('records nothing for an unchanged transient drag', () => {
    const a = doc('a');
    const history = createHistory();
    const result = endTransient(beginTransient(a), history, 0);
    expect(result.changed).toBe(false);
    expect(result.history).toBe(history);
  });

  it('caps the past at the history limit', () => {
    let history = createHistory();
    let current = doc('0');
    const docs: ProjectDoc[] = [current];
    for (let index = 1; index <= HISTORY_LIMIT + 50; index += 1) {
      const next = doc(String(index));
      history = commit(history, current, next, null, index);
      docs.push(next);
      current = next;
    }
    expect(history.past).toHaveLength(HISTORY_LIMIT);
    expect(history.past[0]!.doc).toBe(docs[50]);
    expect(history.past[history.past.length - 1]!.doc).toBe(docs[docs.length - 2]);
  });

  it('clears redo entries after a new commit', () => {
    const a = doc('a');
    const b = doc('b');
    const c = doc('c');
    let history = createHistory();
    history = commit(history, a, b, null, 0);
    const undone = undo(history, b)!;
    expect(undone.history.future).toHaveLength(1);
    const next = commit(undone.history, a, c, null, 5);
    expect(next.future).toHaveLength(0);
    expect(next.past).toHaveLength(1);
  });
});
