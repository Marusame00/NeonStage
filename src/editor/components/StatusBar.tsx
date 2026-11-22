import type { ReactNode } from 'react';
import type { ProviderState, ProviderStatus } from '../../shared/chat';
import { openSettings } from '../state/actions';
import { useEditor, type EditorState } from '../state/store';

const selectStatus = (state: EditorState) => ({
  server: state.server,
  meta: state.meta,
  providers: state.providers,
  scenes: state.doc.scenes,
});

const STATE_WORDS: Record<ProviderState, string> = {
  disconnected: 'off',
  'needs-setup': 'setup',
  authorizing: 'authorizing',
  connecting: 'connecting',
  connected: 'connected',
  reconnecting: 'reconnecting',
  error: 'error',
};

function formatTime(value: number | null): string {
  if (!value) return '';
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function providerLabel(provider: ProviderStatus): string {
  const name = provider.provider === 'twitch' ? 'Twitch' : 'YouTube';
  if (provider.provider === 'twitch' && provider.state === 'connected') {
    return provider.mode === 'signed-in' ? 'Twitch · signed in' : 'Twitch · read-only';
  }
  return `${name} · ${STATE_WORDS[provider.state]}`;
}

function providerTone(provider: ProviderStatus): string {
  if (provider.state === 'connected') return 'is-green';
  if (provider.state === 'error') return 'is-red';
  if (
    provider.state === 'connecting' ||
    provider.state === 'authorizing' ||
    provider.state === 'reconnecting'
  ) {
    return 'is-amber';
  }
  return 'is-grey';
}

export function StatusBar(): ReactNode {
  const { server, meta, providers, scenes } = useEditor(selectStatus);
  const program = scenes.find((scene) => scene.id === meta.programSceneId);
  const serverOk = server.state === 'running';
  const saveLabel =
    meta.saveState === 'saving'
      ? 'Saving…'
      : meta.saveState === 'error'
        ? 'Save failed'
        : meta.lastSavedAt
          ? `Saved ${formatTime(meta.lastSavedAt)}`
          : 'Saved';

  return (
    <footer className="ns-statusbar">
      <span
        className={['ns-status-item', serverOk ? 'is-ok' : 'is-bad'].join(' ')}
        title={server.message ?? (serverOk ? 'Output server is running' : 'Output server is not running')}
      >
        <span className="ns-dot" />
        Output server 127.0.0.1:{server.port}
      </span>
      <span
        className={[
          'ns-status-item',
          meta.saveState === 'error' ? 'is-bad' : meta.saveState === 'saving' ? 'is-warn' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        title={meta.error ?? ''}
      >
        {saveLabel}
      </span>
      <span className="ns-status-item">Program: {program?.name ?? '—'}</span>
      <span className="ns-status-spacer" />
      {providers.map((provider) => (
        <button
          key={provider.provider}
          type="button"
          className={['ns-provider-pill', providerTone(provider)].join(' ')}
          title={`Open ${provider.provider === 'twitch' ? 'Twitch' : 'YouTube'} connection settings`}
          onClick={() => openSettings('connections', provider.provider)}
        >
          <span className="ns-dot" />
          {providerLabel(provider)}
        </button>
      ))}
    </footer>
  );
}
