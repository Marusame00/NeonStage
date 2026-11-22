import { useEffect, useState, type ReactNode } from 'react';
import type { ServerStatus } from '../../../shared/ipc';
import type { SceneNode } from '../../../shared/model';
import { getRenderOrder } from '../../../shared/ops';
import {
  buildOutputScene,
  outputPaths,
  recommendedSize,
  type OutputTarget,
} from '../../../shared/output';
import { patchNode, setServerStatus, toast } from '../../state/actions';
import { selectScene, useEditor, type EditorState } from '../../state/store';
import { Button } from '../../ui/Button';
import { NumberField } from '../../ui/NumberField';
import { Section } from '../../ui/Section';

const selectOutputs = (state: EditorState) => ({
  server: state.server,
  doc: state.doc,
  meta: state.meta,
  scene: selectScene(state),
  selection: state.selection,
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

async function copyUrl(url: string): Promise<void> {
  try {
    await window.neonstage.copyText(url);
    toast('info', 'Copied');
  } catch (error) {
    toast('error', errorMessage(error));
  }
}

async function openUrl(path: string): Promise<void> {
  try {
    await window.neonstage.openOutputInBrowser(path);
  } catch (error) {
    toast('error', errorMessage(error));
  }
}

interface OutputRowProps {
  name: string;
  path: string;
  size: string;
  baseUrl: string | null;
  withOpen?: boolean;
}

function OutputRow({ name, path, size, baseUrl, withOpen = false }: OutputRowProps): ReactNode {
  const url = baseUrl ? `${baseUrl}${path}` : null;
  return (
    <div className="ns-out-row">
      <div className="ns-out-head">
        <span className="ns-out-name" title={name}>
          {name}
        </span>
        <span className="ns-out-meta">{size}</span>
      </div>
      <div className="ns-url">{url ?? 'Server not running'}</div>
      <div className="ns-row" style={{ marginTop: 4 }}>
        <Button size="sm" disabled={!url} onClick={() => void copyUrl(url ?? '')}>
          Copy
        </Button>
        {withOpen ? (
          <Button size="sm" disabled={!url} onClick={() => void openUrl(path)}>
            Open
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function OutputsPanel(): ReactNode {
  const { server, doc, meta, scene, selection } = useEditor(selectOutputs);
  const baseUrl = server.baseUrl;
  const [port, setPort] = useState(server.port);
  const [portError, setPortError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPort(server.port);
  }, [server.port]);

  const runServer = async (call: () => Promise<ServerStatus>): Promise<void> => {
    setBusy(true);
    setPortError(null);
    try {
      const status = await call();
      setServerStatus(status);
      if (status.state !== 'running') {
        setPortError(status.message ?? `The server could not start on port ${status.port}.`);
      }
    } catch (error) {
      setPortError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const programScene = doc.scenes.find((entry) => entry.id === meta.programSceneId) ?? doc.scenes[0]!;
  const livePath = outputPaths({ kind: 'live' }).outputPath;
  const liveUrl = baseUrl ? `${baseUrl}${livePath}` : null;

  const selected = selection.length === 1 ? scene.nodes[selection[0]!] : undefined;
  const selectedTarget: OutputTarget | null = selected
    ? { kind: selected.type === 'group' ? 'group' : 'object', sceneId: scene.id, nodeId: selected.id }
    : null;
  const selectedBuilt = selectedTarget
    ? buildOutputScene(doc, meta.programSceneId, selectedTarget)
    : null;
  const selectedSize = selectedBuilt ? recommendedSize(selectedBuilt) : null;
  const selectedPath = selectedTarget ? outputPaths(selectedTarget).outputPath : null;

  const groups = getRenderOrder(scene)
    .map((id) => scene.nodes[id])
    .filter((node): node is SceneNode => node !== undefined && node.type === 'group');

  return (
    <div>
      <h3 className="ns-panel-head" style={{ padding: 0 }}>
        <span>Outputs</span>
      </h3>

      <Section title="Local server">
        {server.state === 'running' && baseUrl ? (
          <div className="ns-out-status is-ok">
            <span className="ns-dot" />
            <span>Running at {baseUrl}</span>
          </div>
        ) : (
          <div className="ns-callout ns-out-error">
            {server.message ??
              (server.state === 'starting'
                ? 'Starting the local server…'
                : 'The local server is not running.')}
          </div>
        )}
        <div className="ns-row" style={{ alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <NumberField label="Port" value={port} min={1024} max={65535} onChange={setPort} />
          </div>
          <Button
            size="sm"
            disabled={busy || port === server.port}
            onClick={() => void runServer(() => window.neonstage.setPort(port))}
          >
            Apply
          </Button>
          <Button
            size="sm"
            disabled={busy}
            onClick={() => void runServer(() => window.neonstage.restartServer())}
          >
            Restart
          </Button>
        </div>
        {portError ? <div className="ns-error">{portError}</div> : null}
        <p className="ns-hint">
          Keep NeonStage running while you stream — OBS loads the overlay from this app. Output URLs
          stay the same across restarts as long as the port does not change.
        </p>
      </Section>

      <Section title="Full composition">
        <div className="ns-inline-form">
          <div className="ns-out-head">
            <span className="ns-out-name">Program output</span>
            <span className="ns-out-meta">
              {programScene.width} × {programScene.height}
            </span>
          </div>
          <div className="ns-url">{liveUrl ?? 'Server not running'}</div>
          <p className="ns-hint">
            Follows whichever scene you set as Program. Use this as your single Browser Source.
          </p>
          <div className="ns-row">
            <Button
              size="sm"
              variant="primary"
              disabled={!liveUrl}
              onClick={() => void copyUrl(liveUrl ?? '')}
            >
              Copy URL
            </Button>
            <Button size="sm" disabled={!liveUrl} onClick={() => void openUrl(livePath)}>
              Open in browser
            </Button>
          </div>
        </div>
        <div className="ns-panel-head" style={{ padding: 0, height: 20 }}>
          <h2>Specific scenes</h2>
        </div>
        {doc.scenes.map((entry) => (
          <OutputRow
            key={entry.id}
            name={entry.name}
            path={outputPaths({ kind: 'scene', sceneId: entry.id }).outputPath}
            size={`${entry.width} × ${entry.height}`}
            baseUrl={baseUrl}
            withOpen
          />
        ))}
      </Section>

      <Section title="Selected object or group">
        {selected && selectedPath && selectedSize ? (
          <>
            <OutputRow
              name={selected.name}
              path={selectedPath}
              size={`${selectedSize.width} × ${selectedSize.height}`}
              baseUrl={baseUrl}
              withOpen
            />
            <NumberField
              label="Output padding"
              value={selected.output.padding}
              min={0}
              max={400}
              unit="px"
              onChange={(value) =>
                patchNode(
                  selected.id,
                  { output: { ...selected.output, padding: value } },
                  `${selected.id}:padding`,
                )
              }
            />
            <p className="ns-hint">
              Bounds include glow, shadow and padding. Changes reach OBS after Publish to OBS (or
              with Live edit on).
            </p>
          </>
        ) : (
          <p className="ns-hint">
            Select an object or group on the canvas to get its own Browser Source URL.
          </p>
        )}
        <div className="ns-panel-head" style={{ padding: 0, height: 20 }}>
          <h2>Groups in this scene</h2>
        </div>
        {groups.length === 0 ? (
          <p className="ns-hint">This scene has no groups.</p>
        ) : (
          groups.map((group) => {
            const built = buildOutputScene(doc, meta.programSceneId, {
              kind: 'group',
              sceneId: scene.id,
              nodeId: group.id,
            });
            const size = built ? recommendedSize(built) : null;
            return (
              <OutputRow
                key={group.id}
                name={group.name}
                path={outputPaths({ kind: 'group', sceneId: scene.id, nodeId: group.id }).outputPath}
                size={size ? `${size.width} × ${size.height}` : '—'}
                baseUrl={baseUrl}
              />
            );
          })
        )}
      </Section>

      <div className="ns-callout is-info" style={{ margin: '10px 0' }}>
        <strong>Layering with Game / Video Capture.</strong> A single Browser Source is one layer in
        OBS: everything in it sits either above or below your Game Capture or Video Capture. Frames
        in NeonStage have transparent interiors, so put the capture source below the overlay. If you
        need some overlay parts behind the capture and others in front, put them in separate groups
        (for example &apos;Background&apos; and &apos;Front&apos;) and add each group&apos;s URL as
        its own Browser Source, ordered around the capture in OBS.
      </div>

      <Section title="OBS setup" defaultOpen={false}>
        <ol className="ns-steps">
          <li>
            In OBS open <strong>Sources</strong> and click <strong>+</strong> →{' '}
            <strong>Browser</strong>.
          </li>
          <li>
            Uncheck <strong>Local file</strong>.
          </li>
          <li>Paste the output URL into the URL field.</li>
          <li>
            Set <strong>Width</strong> and <strong>Height</strong> to the recommended size shown
            above.
          </li>
          <li>Leave the default Custom CSS as it is.</li>
          <li>
            Keep <strong>Shutdown source when not visible</strong> off so chat history continues
            across scene switches.
          </li>
          <li>
            Put your <strong>Game Capture</strong> or <strong>Video Capture</strong> source below the
            Browser Source.
          </li>
        </ol>
        <p className="ns-hint">
          The page is transparent and scales to fit (contain) when the source is sized differently.
          Add <span className="ns-url">?fit=none</span> to the URL to disable scaling.
        </p>
      </Section>
    </div>
  );
}
