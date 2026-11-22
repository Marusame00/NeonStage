import { describe, expect, it } from 'vitest';
import {
  emptyRuntime,
  formatDuration,
  pruneRuntime,
  sessionAction,
  setGoal,
  timerAction,
  timerElapsedMs,
} from '../src/shared/runtime';

describe('timerAction', () => {
  it('starts, pauses, resumes and resets with explicit now values', () => {
    let state = emptyRuntime();
    state = timerAction(state, 'n1', 'start', 1000);
    expect(timerElapsedMs(state.timers['n1'], 4000)).toBe(3000);

    state = timerAction(state, 'n1', 'pause', 4000);
    expect(state.timers['n1']!.running).toBe(false);
    expect(timerElapsedMs(state.timers['n1'], 9000)).toBe(3000);

    state = timerAction(state, 'n1', 'start', 10_000);
    expect(timerElapsedMs(state.timers['n1'], 12_000)).toBe(5000);

    state = timerAction(state, 'n1', 'reset', 13_000);
    expect(timerElapsedMs(state.timers['n1'], 20_000)).toBe(0);
  });

  it('toggles between running and paused', () => {
    let state = timerAction(emptyRuntime(), 'n1', 'toggle', 500);
    expect(state.timers['n1']!.running).toBe(true);
    state = timerAction(state, 'n1', 'toggle', 1500);
    expect(state.timers['n1']!.running).toBe(false);
    expect(state.timers['n1']!.accumulatedMs).toBe(1000);
  });

  it('ignores a second start', () => {
    let state = timerAction(emptyRuntime(), 'n1', 'start', 100);
    state = timerAction(state, 'n1', 'start', 900);
    expect(state.timers['n1']!.startedAt).toBe(100);
  });
});

describe('server clock offset', () => {
  it('gives identical values for clients with different local clocks', () => {
    const timer = { running: true, startedAt: 5000, accumulatedMs: 0 };
    const serverNow = 8000;
    const clientA = { localNow: 12_000, offset: serverNow - 12_000 };
    const clientB = { localNow: 30_000, offset: serverNow - 30_000 };

    const a = timerElapsedMs(timer, clientA.localNow + clientA.offset);
    const b = timerElapsedMs(timer, clientB.localNow + clientB.offset);
    expect(a).toBe(3000);
    expect(b).toBe(3000);
  });
});

describe('formatDuration', () => {
  it('formats auto, hh:mm:ss and mm:ss', () => {
    expect(formatDuration(0, 'auto')).toBe('00:00');
    expect(formatDuration(59_000, 'auto')).toBe('00:59');
    expect(formatDuration(60_000, 'auto')).toBe('01:00');
    expect(formatDuration(3_599_000, 'auto')).toBe('59:59');
    expect(formatDuration(3_600_000, 'auto')).toBe('01:00:00');
    expect(formatDuration(3_661_000, 'hh:mm:ss')).toBe('01:01:01');
    expect(formatDuration(90_000, 'mm:ss')).toBe('01:30');
    expect(formatDuration(7_200_000, 'mm:ss')).toBe('120:00');
    expect(formatDuration(-5000, 'auto')).toBe('00:00');
  });
});

describe('goals and session', () => {
  it('sets a manual goal value', () => {
    const state = setGoal(emptyRuntime(), 'g1', 42);
    expect(state.goals['g1']).toEqual({ current: 42 });
  });

  it('starts and stops the session clock', () => {
    let state = sessionAction(emptyRuntime(), 'start', 1000);
    expect(state.session.startedAt).toBe(1000);
    state = sessionAction(state, 'start', 2000);
    expect(state.session.startedAt).toBe(1000);
    state = sessionAction(state, 'stop', 3000);
    expect(state.session.startedAt).toBeNull();
    state = sessionAction(state, 'reset', 4000);
    expect(state.session.startedAt).toBeNull();
  });
});

describe('pruneRuntime', () => {
  it('drops entries for nodes that are gone', () => {
    let state = emptyRuntime();
    state = timerAction(state, 'keep', 'start', 0);
    state = timerAction(state, 'drop', 'start', 0);
    state = setGoal(state, 'keep', 1);
    state = setGoal(state, 'drop', 2);

    const pruned = pruneRuntime(state, new Set(['keep']));
    expect(Object.keys(pruned.timers)).toEqual(['keep']);
    expect(Object.keys(pruned.goals)).toEqual(['keep']);
  });
});
