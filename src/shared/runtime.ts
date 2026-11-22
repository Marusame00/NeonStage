export interface TimerRuntime {
  running: boolean;
  startedAt: number | null;
  accumulatedMs: number;
}

export interface GoalRuntime {
  current: number;
}

export interface SessionRuntime {
  startedAt: number | null;
}

export interface RuntimeState {
  timers: Record<string, TimerRuntime>;
  goals: Record<string, GoalRuntime>;
  session: SessionRuntime;
}

export type TimerAction = 'start' | 'pause' | 'reset' | 'toggle';
export type SessionAction = 'start' | 'stop' | 'reset';
export type DurationFormat = 'hh:mm:ss' | 'mm:ss' | 'auto';

const EMPTY_TIMER: TimerRuntime = { running: false, startedAt: null, accumulatedMs: 0 };

export function emptyRuntime(): RuntimeState {
  return { timers: {}, goals: {}, session: { startedAt: null } };
}

export function timerElapsedMs(timer: TimerRuntime | undefined, serverNow: number): number {
  if (!timer) return 0;
  const accumulated = Math.max(0, timer.accumulatedMs);
  if (!timer.running || timer.startedAt === null) return accumulated;
  return accumulated + Math.max(0, serverNow - timer.startedAt);
}

export function timerAction(
  state: RuntimeState,
  nodeId: string,
  action: TimerAction,
  now: number,
): RuntimeState {
  const current = state.timers[nodeId] ?? EMPTY_TIMER;
  const resolved: TimerAction =
    action === 'toggle' ? (current.running ? 'pause' : 'start') : action;

  let next: TimerRuntime;
  switch (resolved) {
    case 'start':
      next = current.running
        ? current
        : { running: true, startedAt: now, accumulatedMs: Math.max(0, current.accumulatedMs) };
      break;
    case 'pause':
      next = current.running
        ? {
            running: false,
            startedAt: null,
            accumulatedMs: timerElapsedMs(current, now),
          }
        : current;
      break;
    case 'reset':
      next = { running: false, startedAt: null, accumulatedMs: 0 };
      break;
  }

  return { ...state, timers: { ...state.timers, [nodeId]: next } };
}

export function setGoal(state: RuntimeState, nodeId: string, value: number): RuntimeState {
  const current = Number.isFinite(value) ? value : 0;
  return { ...state, goals: { ...state.goals, [nodeId]: { current } } };
}

export function sessionAction(state: RuntimeState, action: SessionAction, now: number): RuntimeState {
  switch (action) {
    case 'start':
      return state.session.startedAt === null
        ? { ...state, session: { startedAt: now } }
        : state;
    case 'stop':
      return state.session.startedAt === null ? state : { ...state, session: { startedAt: null } };
    case 'reset':
      return state.session.startedAt === null ? state : { ...state, session: { startedAt: null } };
  }
}

export function formatDuration(ms: number, format: DurationFormat): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');

  const useHours = format === 'hh:mm:ss' || (format === 'auto' && totalSeconds >= 3600);
  if (useHours) return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;

  const totalMinutes = Math.floor(totalSeconds / 60);
  return `${pad(totalMinutes)}:${pad(seconds)}`;
}

export function pruneRuntime(state: RuntimeState, liveNodeIds: Set<string>): RuntimeState {
  const timers: Record<string, TimerRuntime> = {};
  for (const [nodeId, timer] of Object.entries(state.timers)) {
    if (liveNodeIds.has(nodeId)) timers[nodeId] = timer;
  }
  const goals: Record<string, GoalRuntime> = {};
  for (const [nodeId, goal] of Object.entries(state.goals)) {
    if (liveNodeIds.has(nodeId)) goals[nodeId] = goal;
  }
  return { ...state, timers, goals };
}
