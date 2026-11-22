import type { ReactNode } from 'react';
import { RenderProvider, useRuntime, useServerNow } from '../../../render';
import type { Scene, SceneNode } from '../../../shared/model';
import { getRenderOrder } from '../../../shared/ops';
import { formatDuration, timerElapsedMs } from '../../../shared/runtime';
import { getWidget } from '../../../widgets/registry';
import type { GoalProps } from '../../../widgets/goal/definition';
import type { TimerProps } from '../../../widgets/timer/definition';
import { renderStores, selectNodeInScene, toast } from '../../state/actions';
import { useEditor, type EditorState } from '../../state/store';
import { Button } from '../../ui/Button';
import { NumberField } from '../../ui/NumberField';
import { Section } from '../../ui/Section';

const NO_MEDIA = (): string => '';

const selectDoc = (state: EditorState) => state.doc;

async function run(call: () => Promise<void>): Promise<void> {
  try {
    await call();
  } catch (error) {
    toast('error', error instanceof Error ? error.message : 'The action failed.');
  }
}

function runtimeNodes(scene: Scene, slot: 'timer' | 'goal'): SceneNode[] {
  return getRenderOrder(scene)
    .map((id) => scene.nodes[id])
    .filter(
      (node): node is SceneNode =>
        node !== undefined &&
        node.type === 'widget' &&
        node.widget !== null &&
        getWidget(node.widget.kind)?.runtime === slot,
    );
}

export function ControlsPanel(): ReactNode {
  return (
    <RenderProvider mode="editor" stores={renderStores} mediaUrl={NO_MEDIA}>
      <ControlsBody />
    </RenderProvider>
  );
}

function ControlsBody(): ReactNode {
  const doc = useEditor(selectDoc);
  const runtime = useRuntime();
  const now = useServerNow(250);

  const startedAt = runtime.session.startedAt;
  const sessionElapsed = startedAt === null ? null : Math.max(0, now - startedAt);
  const timerRows = doc.scenes
    .map((scene) => ({ scene, nodes: runtimeNodes(scene, 'timer') }))
    .filter((entry) => entry.nodes.length > 0);
  const goalRows = doc.scenes
    .map((scene) => ({ scene, nodes: runtimeNodes(scene, 'goal') }))
    .filter((entry) => entry.nodes.length > 0);

  return (
    <div>
      <h3 className="ns-panel-head" style={{ padding: 0 }}>
        <span>Controls</span>
      </h3>
      <p className="ns-hint" style={{ marginBottom: 8 }}>
        Controls affect what OBS shows right now
      </p>

      <Section title="Session clock">
        <div className="ns-readout">{sessionElapsed === null ? 'Not started' : formatDuration(sessionElapsed, 'hh:mm:ss')}</div>
        <div className="ns-row">
          <Button
            size="sm"
            disabled={startedAt !== null}
            onClick={() => void run(() => window.neonstage.sessionAction('start'))}
          >
            Start
          </Button>
          <Button
            size="sm"
            disabled={startedAt === null}
            onClick={() => void run(() => window.neonstage.sessionAction('stop'))}
          >
            Stop
          </Button>
          <Button size="sm" onClick={() => void run(() => window.neonstage.sessionAction('reset'))}>
            Reset
          </Button>
        </div>
      </Section>

      <Section title="Timers">
        {timerRows.length === 0 ? (
          <div className="ns-empty">Add a Timer widget from the Library.</div>
        ) : (
          timerRows.map(({ scene, nodes }) => (
            <div key={scene.id} className="ns-ctl-group">
              <div className="ns-ctl-scene">{scene.name}</div>
              {nodes.map((node) => {
                const props = node.widget!.props as TimerProps;
                const timer = runtime.timers[node.id];
                const elapsed = timerElapsedMs(timer, now);
                const running = timer?.running === true;
                const readout =
                  props.mode === 'countdown'
                    ? formatDuration(Math.max(0, props.durationMs - elapsed), props.format)
                    : formatDuration(elapsed, props.format);
                const modeLabel =
                  props.mode === 'countdown'
                    ? `Countdown ${formatDuration(props.durationMs, 'mm:ss')}`
                    : 'Elapsed';
                return (
                  <div key={node.id} className="ns-ctl">
                    <div className="ns-ctl-head">
                      <button
                        type="button"
                        className="ns-ctl-name"
                        title={node.name}
                        onClick={() => selectNodeInScene(scene.id, node.id)}
                      >
                        {node.name}
                      </button>
                      <span className="ns-out-meta">{modeLabel}</span>
                    </div>
                    <div className="ns-row">
                      <span className="ns-readout" style={{ flex: 1 }}>
                        {readout}
                      </span>
                      <Button
                        size="sm"
                        onClick={() => void run(() => window.neonstage.timerAction(node.id, 'toggle'))}
                      >
                        {running ? 'Pause' : 'Start'}
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => void run(() => window.neonstage.timerAction(node.id, 'reset'))}
                      >
                        Reset
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
        <p className="ns-hint">
          All Browser Sources show the same time — timers run once in NeonStage, not per source.
        </p>
      </Section>

      <Section title="Manual goals">
        {goalRows.length === 0 ? (
          <div className="ns-empty">Add a Goal widget from the Library.</div>
        ) : (
          goalRows.map(({ scene, nodes }) => (
            <div key={scene.id} className="ns-ctl-group">
              <div className="ns-ctl-scene">{scene.name}</div>
              {nodes.map((node) => {
                const props = node.widget!.props as GoalProps;
                const current = runtime.goals[node.id]?.current ?? props.startValue;
                const setValue = (value: number): void => {
                  void run(() => window.neonstage.setGoal(node.id, Math.max(0, value)));
                };
                return (
                  <div key={node.id} className="ns-ctl">
                    <div className="ns-ctl-head">
                      <button
                        type="button"
                        className="ns-ctl-name"
                        title={node.name}
                        onClick={() => selectNodeInScene(scene.id, node.id)}
                      >
                        {props.title || node.name}
                      </button>
                      <span className="ns-out-meta">
                        {current} / {props.target} {props.unit}
                      </span>
                    </div>
                    <div className="ns-row">
                      <div style={{ flex: 1 }}>
                        <NumberField
                          value={current}
                          min={0}
                          max={1_000_000}
                          step={1}
                          onChange={setValue}
                        />
                      </div>
                      <Button size="sm" onClick={() => setValue(current - 1)}>
                        −1
                      </Button>
                      <Button size="sm" onClick={() => setValue(current + 1)}>
                        +1
                      </Button>
                      <Button size="sm" onClick={() => setValue(current + 5)}>
                        +5
                      </Button>
                      <Button size="sm" onClick={() => setValue(current + 10)}>
                        +10
                      </Button>
                    </div>
                    <p className="ns-hint">
                      Manual goal — not connected to donations, subscriptions or followers.
                    </p>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </Section>
    </div>
  );
}
