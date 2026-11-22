import { useEffect, useState, type ReactNode } from 'react';
import type { ProviderState, ProviderStatus } from '../../../shared/chat';
import type { ProviderSettings, TwitchAuthPrompt, YouTubeBroadcast } from '../../../shared/ipc';
import { formatDuration } from '../../../shared/runtime';
import { setProviders, toast } from '../../state/actions';
import { useEditor, type EditorState } from '../../state/store';
import { Button } from '../../ui/Button';
import { NumberField } from '../../ui/NumberField';
import { Section } from '../../ui/Section';

const selectProviders = (state: EditorState) => state.providers;
const selectSecretsPersistent = (state: EditorState) => state.secretsPersistent;

const STATE_WORDS: Record<ProviderState, string> = {
  'needs-setup': 'Not set up',
  disconnected: 'Signed out',
  authorizing: 'Waiting for authorization',
  connecting: 'Connecting',
  connected: 'Connected',
  reconnecting: 'Reconnecting',
  error: 'Error',
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

function statusWord(status: ProviderStatus | undefined): string {
  if (!status) return 'Not set up';
  if (status.state === 'connected') {
    return status.account ? `Connected as ${status.account}` : 'Connected';
  }
  return STATE_WORDS[status.state];
}

function statusClass(status: ProviderStatus | undefined): string {
  if (!status) return 'is-amber';
  if (status.state === 'connected') return 'is-green';
  if (status.state === 'error') return 'is-red';
  return 'is-amber';
}

function twitchModeLine(status: ProviderStatus | undefined): string {
  if (status?.mode === 'signed-in') {
    return status.account ? `Signed in as ${status.account}.` : 'Signed in with your Twitch app.';
  }
  return 'Reading chat anonymously — read-only.';
}

async function copyText(text: string): Promise<void> {
  try {
    await window.neonstage.copyText(text);
    toast('info', 'Copied');
  } catch (error) {
    toast('error', errorMessage(error));
  }
}

function ProviderHead({
  name,
  status,
}: {
  name: string;
  status: ProviderStatus | undefined;
}): ReactNode {
  return (
    <div className="ns-conn-head">
      <strong>{name}</strong>
      <span className={['ns-pill', statusClass(status)].join(' ')}>{statusWord(status)}</span>
    </div>
  );
}

function ProviderDetail({ status }: { status: ProviderStatus | undefined }): ReactNode {
  if (!status) return null;
  return (
    <>
      {status.message ? <div className="ns-hint">{status.message}</div> : null}
      {status.sources.map((source) => (
        <div key={source.key} className="ns-src-row">
          <span className="ns-url">{source.key}</span>
          <span className="ns-out-meta">{source.state}</span>
          {source.detail ? <span className="ns-hint">{source.detail}</span> : null}
        </div>
      ))}
    </>
  );
}

export function ConnectionsPanel(): ReactNode {
  const providers = useEditor(selectProviders);
  const secretsPersistent = useEditor(selectSecretsPersistent);
  const twitch = providers.find((entry) => entry.provider === 'twitch');
  const youtube = providers.find((entry) => entry.provider === 'youtube');

  const [settings, setSettings] = useState<ProviderSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [twitchClientId, setTwitchClientId] = useState('');
  const [twitchError, setTwitchError] = useState<string | null>(null);
  const [twitchBusy, setTwitchBusy] = useState(false);
  const [prompt, setPrompt] = useState<TwitchAuthPrompt | null>(null);
  const [tick, setTick] = useState(() => Date.now());

  const [youtubeClientId, setYoutubeClientId] = useState('');
  const [youtubeSecret, setYoutubeSecret] = useState('');
  const [pollSec, setPollSec] = useState(5);
  const [youtubeError, setYoutubeError] = useState<string | null>(null);
  const [youtubeBusy, setYoutubeBusy] = useState(false);
  const [youtubeAuth, setYoutubeAuth] = useState(false);
  const [broadcasts, setBroadcasts] = useState<YouTubeBroadcast[] | null>(null);
  const [broadcastError, setBroadcastError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [next, statuses] = await Promise.all([
          window.neonstage.providers.getSettings(),
          window.neonstage.providers.getStatus(),
        ]);
        if (!alive) return;
        setSettings(next);
        setTwitchClientId(next.twitch.clientId);
        setPollSec(Math.round(next.youtube.minPollMs / 1000));
        setProviders(statuses);
      } catch (error) {
        if (alive) setLoadError(errorMessage(error));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!prompt) return;
    const id = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [prompt]);

  const saveTwitch = async (): Promise<void> => {
    setTwitchBusy(true);
    setTwitchError(null);
    try {
      const next = await window.neonstage.providers.twitchConfigure({
        clientId: twitchClientId.trim(),
      });
      setSettings(next);
      toast('info', 'Twitch client ID saved.');
    } catch (error) {
      setTwitchError(errorMessage(error));
    } finally {
      setTwitchBusy(false);
    }
  };

  const connectTwitch = async (): Promise<void> => {
    setTwitchBusy(true);
    setTwitchError(null);
    try {
      const next = await window.neonstage.providers.twitchStartAuth();
      setPrompt(next);
      setTick(Date.now());
    } catch (error) {
      setTwitchError(errorMessage(error));
    } finally {
      setTwitchBusy(false);
    }
  };

  const cancelTwitch = async (): Promise<void> => {
    setTwitchBusy(true);
    setTwitchError(null);
    try {
      await window.neonstage.providers.twitchCancelAuth();
      setPrompt(null);
    } catch (error) {
      setTwitchError(errorMessage(error));
    } finally {
      setTwitchBusy(false);
    }
  };

  const signOutTwitch = async (): Promise<void> => {
    setTwitchBusy(true);
    setTwitchError(null);
    try {
      await window.neonstage.providers.twitchSignOut();
      setPrompt(null);
    } catch (error) {
      setTwitchError(errorMessage(error));
    } finally {
      setTwitchBusy(false);
    }
  };

  const reconnect = async (provider: 'twitch' | 'youtube'): Promise<void> => {
    const setError = provider === 'twitch' ? setTwitchError : setYoutubeError;
    const setBusy = provider === 'twitch' ? setTwitchBusy : setYoutubeBusy;
    setBusy(true);
    setError(null);
    try {
      await window.neonstage.providers.reconnect(provider);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const saveYoutube = async (): Promise<void> => {
    const clientId = youtubeClientId.trim();
    if (!clientId || !youtubeSecret) {
      setYoutubeError('Enter the client ID and client secret.');
      return;
    }
    setYoutubeBusy(true);
    setYoutubeError(null);
    try {
      const next = await window.neonstage.providers.youtubeConfigure({
        clientId,
        clientSecret: youtubeSecret,
        minPollMs: Math.round(pollSec * 1000),
      });
      setSettings(next);
      setYoutubeSecret('');
      toast('info', 'YouTube client saved.');
    } catch (error) {
      setYoutubeError(errorMessage(error));
    } finally {
      setYoutubeBusy(false);
    }
  };

  const connectYoutube = async (): Promise<void> => {
    setYoutubeBusy(true);
    setYoutubeError(null);
    try {
      await window.neonstage.providers.youtubeStartAuth();
      setYoutubeAuth(true);
    } catch (error) {
      setYoutubeError(errorMessage(error));
    } finally {
      setYoutubeBusy(false);
    }
  };

  const cancelYoutube = async (): Promise<void> => {
    setYoutubeBusy(true);
    setYoutubeError(null);
    try {
      await window.neonstage.providers.youtubeCancelAuth();
      setYoutubeAuth(false);
    } catch (error) {
      setYoutubeError(errorMessage(error));
    } finally {
      setYoutubeBusy(false);
    }
  };

  const signOutYoutube = async (): Promise<void> => {
    setYoutubeBusy(true);
    setYoutubeError(null);
    try {
      await window.neonstage.providers.youtubeSignOut();
      setYoutubeAuth(false);
      setBroadcasts(null);
    } catch (error) {
      setYoutubeError(errorMessage(error));
    } finally {
      setYoutubeBusy(false);
    }
  };

  const listBroadcasts = async (): Promise<void> => {
    setYoutubeBusy(true);
    setBroadcastError(null);
    try {
      setBroadcasts(await window.neonstage.providers.youtubeListBroadcasts());
    } catch (error) {
      setBroadcastError(errorMessage(error));
    } finally {
      setYoutubeBusy(false);
    }
  };

  const remaining = prompt ? Math.max(0, prompt.expiresAt - tick) : 0;
  const quotaHours = (2000 * pollSec) / 3600;

  return (
    <div>
      <h3 className="ns-panel-head" style={{ padding: 0 }}>
        <span>Connections</span>
      </h3>

      {loadError ? <div className="ns-error">{loadError}</div> : null}

      <div id="ns-conn-twitch">
        <Section title="Twitch">
          <ProviderHead name="Twitch chat" status={twitch} />
          <ProviderDetail status={twitch} />
          <p className="ns-hint">
            Twitch chat works with just a channel name — add a Twitch Chat widget and type the
            channel. No account or sign-in needed (read-only).
          </p>
          <p className="ns-hint">{twitchModeLine(twitch)}</p>
          {twitch?.mode === 'signed-in' ? (
            <div className="ns-row">
              <Button size="sm" disabled={twitchBusy} onClick={() => void reconnect('twitch')}>
                Reconnect
              </Button>
              <Button size="sm" disabled={twitchBusy} onClick={() => void signOutTwitch()}>
                Sign out (back to anonymous)
              </Button>
            </div>
          ) : null}
          <details className="ns-details">
            <summary>Advanced: sign in with your own Twitch app (optional)</summary>
            <div className="ns-details-body">
              <p className="ns-hint">
                Signing in uses Twitch&apos;s official EventSub API. It is useful for reading your
                own channel with @me and for future features.
              </p>
              <p className="ns-hint">
                NeonStage reads chat through Twitch&apos;s official EventSub API using your own Twitch
                application (free). Register an application at dev.twitch.tv/console → Applications →
                Register: Client Type Public, OAuth Redirect URL http://localhost (required by the form;
                the device flow does not use it). Paste its Client ID below.
              </p>
              <Button
                size="sm"
                onClick={() => window.open('https://dev.twitch.tv/console/apps', '_blank')}
              >
                Open Twitch developer console
              </Button>
              <label className="ns-field">
                <span className="ns-field-label">Client ID</span>
                <input
                  className="ns-textinput"
                  value={twitchClientId}
                  spellCheck={false}
                  placeholder="Twitch application client ID"
                  onChange={(event) => setTwitchClientId(event.target.value)}
                />
              </label>
              <div className="ns-row">
                <Button size="sm" variant="primary" disabled={twitchBusy} onClick={() => void saveTwitch()}>
                  Save
                </Button>
                <Button size="sm" disabled={twitchBusy} onClick={() => void connectTwitch()}>
                  Connect Twitch
                </Button>
              </div>
              {twitchError ? <div className="ns-error">{twitchError}</div> : null}
              {prompt ? (
                <div className="ns-inline-form">
                  <div className="ns-code">{prompt.userCode}</div>
                  <div className="ns-row">
                    <Button size="sm" onClick={() => void copyText(prompt.userCode)}>
                      Copy
                    </Button>
                    <span className="ns-out-meta">Expires in {formatDuration(remaining, 'mm:ss')}</span>
                  </div>
                  <div className="ns-url">{prompt.verificationUri}</div>
                  <div className="ns-row">
                    <Button size="sm" onClick={() => window.open(prompt.verificationUri, '_blank')}>
                      Open activation page
                    </Button>
                    <Button size="sm" disabled={twitchBusy} onClick={() => void cancelTwitch()}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : null}
              <p className="ns-hint">
                Requested permission: user:read:chat (read chat messages). NeonStage never posts to chat.
              </p>
            </div>
          </details>
        </Section>
      </div>

      <div id="ns-conn-youtube">
        <Section title="YouTube">
        <ProviderHead name="YouTube chat" status={youtube} />
        <ProviderDetail status={youtube} />
        <p className="ns-hint">
          YouTube live chat uses the YouTube Data API with your own Google Cloud project: create a
          project, enable &apos;YouTube Data API v3&apos;, configure the OAuth consent screen
          (External, add yourself as a test user), then create an OAuth client ID of type Desktop app
          and paste its Client ID and Client secret here. Requested permission: youtube.readonly.
        </p>
        <div className="ns-row">
          <Button
            size="sm"
            onClick={() => window.open('https://console.cloud.google.com/apis/credentials', '_blank')}
          >
            Open credentials
          </Button>
          <Button
            size="sm"
            onClick={() =>
              window.open('https://developers.google.com/youtube/v3/live/getting-started', '_blank')
            }
          >
            Live chat docs
          </Button>
        </div>
        <div className="ns-callout is-warn">
          While the consent screen is in Testing mode Google expires sign-ins after 7 days —
          you&apos;ll need to reconnect.
        </div>
        <label className="ns-field">
          <span className="ns-field-label">Client ID</span>
          <input
            className="ns-textinput"
            value={youtubeClientId}
            spellCheck={false}
            placeholder={
              settings?.youtube.clientIdSet ? 'A client is saved' : 'xxxx.apps.googleusercontent.com'
            }
            onChange={(event) => setYoutubeClientId(event.target.value)}
          />
        </label>
        <label className="ns-field">
          <span className="ns-field-label">Client secret</span>
          <input
            className="ns-textinput"
            type="password"
            value={youtubeSecret}
            spellCheck={false}
            placeholder={settings?.youtube.clientIdSet ? 'A client is saved' : ''}
            onChange={(event) => setYoutubeSecret(event.target.value)}
          />
        </label>
        {settings?.youtube.clientIdSet ? <p className="ns-hint">A client is saved.</p> : null}
        <NumberField
          label="Minimum poll interval"
          value={pollSec}
          min={2}
          max={120}
          unit="s"
          onChange={setPollSec}
        />
        <div className="ns-row">
          <Button
            size="sm"
            variant="primary"
            disabled={youtubeBusy}
            onClick={() => void saveYoutube()}
          >
            Save
          </Button>
          <Button size="sm" disabled={youtubeBusy} onClick={() => void connectYoutube()}>
            Connect
          </Button>
        </div>
        {youtubeError ? <div className="ns-error">{youtubeError}</div> : null}
        {youtubeAuth ? (
          <div className="ns-inline-form">
            <p className="ns-hint">Complete sign-in in your browser…</p>
            <Button size="sm" disabled={youtubeBusy} onClick={() => void cancelYoutube()}>
              Cancel
            </Button>
          </div>
        ) : null}
        {youtube?.state === 'connected' ? (
          <div className="ns-row">
            <Button size="sm" disabled={youtubeBusy} onClick={() => void reconnect('youtube')}>
              Reconnect
            </Button>
            <Button size="sm" disabled={youtubeBusy} onClick={() => void signOutYoutube()}>
              Sign out
            </Button>
            <Button size="sm" disabled={youtubeBusy} onClick={() => void listBroadcasts()}>
              Find my broadcasts
            </Button>
          </div>
        ) : null}
        <div className="ns-callout">
          Each chat poll costs 5 quota units. The default daily quota is 10,000 units (≈ 2,000
          polls). At one poll every {pollSec} s, chat lasts about{' '}
          <span style={quotaHours < 4 ? { color: 'var(--amber)' } : undefined}>
            {quotaHours.toFixed(1)} hours
          </span>{' '}
          per day.
        </div>
        <p className="ns-hint">
          NeonStage always waits at least as long as YouTube requests between polls.
        </p>
        {broadcasts ? (
          broadcasts.length === 0 ? (
            <p className="ns-hint">No broadcasts found.</p>
          ) : (
            <table className="ns-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Chat</th>
                </tr>
              </thead>
              <tbody>
                {broadcasts.map((entry) => (
                  <tr key={entry.id}>
                    <td className="ns-url">{entry.id}</td>
                    <td>{entry.title}</td>
                    <td>{entry.status}</td>
                    <td>{entry.liveChatId ? 'yes' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : null}
        {broadcastError ? <div className="ns-error">{broadcastError}</div> : null}
        <p className="ns-hint">
          &apos;My active broadcast&apos; follows whichever broadcast YouTube reports as active;
          paste a video ID in the widget to use a specific broadcast instead.
        </p>
      </Section>
      </div>

      <div className="ns-callout is-info" style={{ margin: '10px 0' }}>
        <strong>Demo chat.</strong> Demo mode generates clearly labelled sample messages so you can
        design without connecting accounts. It is never reported as a live connection and is hidden
        in OBS unless a widget enables &apos;Show demo in output&apos;.
      </div>

      <div className="ns-callout" style={{ marginBottom: 8 }}>
        <strong>Security.</strong> Tokens are encrypted with Windows (DPAPI via Electron safeStorage)
        and stored only on this PC. They are never included in project exports or sent to OBS.
      </div>

      {!secretsPersistent ? (
        <div className="ns-callout is-warn">
          OS encryption is unavailable, so sign-ins are kept in memory only and you&apos;ll need to
          reconnect after restarting.
        </div>
      ) : null}
    </div>
  );
}
