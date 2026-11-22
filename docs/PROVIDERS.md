# NeonStage — Live chat providers

NeonStage reads chat straight from the provider. Twitch chat needs nothing but a channel name; YouTube chat
uses your own Google credentials. Nothing is shared between installs, there is no NeonStage account or relay
server, and all traffic goes from your PC straight to Twitch or Google.

Both integrations live in the Electron main process (`src/main/providers/`). Tokens never reach the editor,
the overlay page, project exports or the log.

## Twitch

Twitch chat works with just a channel name. Add a **Twitch chat** widget, set Source to **Live channel** and
type the channel — no account, no sign-in, no developer application. That anonymous mode is the default and
it is read-only. The developer sign-in described further down is optional.

### 1. Anonymous read-only chat (default)

- NeonStage opens one WebSocket to `wss://irc-ws.chat.twitch.tv:443` and logs in with the long-standing
  anonymous `justinfan` IRC login (`PASS SCHMOOPIIE`, `NICK justinfan#####`). Twitch staff have
  acknowledged this login on the developer forums, but it is not a formally documented API page, so treat it
  as best-effort: it can change or be rate limited without notice.
- It requests `twitch.tv/tags` and `twitch.tv/commands`, so messages carry display name, colour, badges,
  emotes and message ids, and Twitch can send `CLEARCHAT` / `CLEARMSG` so deleted messages disappear from
  the overlay too.
- Read-only: NeonStage never sends a chat message, never authenticates as you and never puts a token on this
  socket.
- One shared socket for every anonymous channel in the project. Twitch limits how many channels one
  connection may join, so keep the number of anonymous channels small; NeonStage joins at most 20 channels
  per 10 seconds and closes the socket when the last channel is released.
- Reconnects with exponential backoff (1, 2, 4, 8, 16 s, capped at 30 s) and rejoins every channel. A
  watchdog forces a reconnect when nothing arrives for 6 minutes.
- A channel that does not exist, is suspended or is otherwise unavailable puts the source offline with a
  short reason.
- `twitch:@me` (the widget's "blank = your channel" default) needs a sign-in; without one the source shows
  "Enter a channel name (or sign in to use your own channel)".

### 2. Optional: sign in with your own Twitch application

Signing in is not required for chat. It uses Twitch's official EventSub API, which is useful for reading
your own channel with `@me` and for future features. Everything below is optional and lives under
**Advanced: sign in with your own Twitch app (optional)** in Connections.

#### 2.1 Register a Twitch application

1. Open <https://dev.twitch.tv/console/apps> and sign in with the Twitch account whose chat you want to read.
2. **Register Your Application**.
3. Name: anything you like (for example `NeonStage`).
4. **OAuth Redirect URLs**: `http://localhost` — the form requires a value, but the device code flow never
   uses it.
5. Category: any.
6. **Client Type: Public**. A public client has no client secret, which is what the device code flow needs.
7. Create, then copy the **Client ID**.

#### 2.2 Paste the Client ID into NeonStage

Connections → Twitch → Advanced → Client ID → **Save**. Changing the Client ID later signs you out, because
the old token belongs to the old application.

#### 2.3 Sign in with a device code

Press **Connect Twitch**. NeonStage asks Twitch for a device code and shows an eight-character code plus
<https://www.twitch.tv/activate>. Open that page, enter the code, approve the app. NeonStage polls Twitch
every few seconds until you approve, then stores the tokens and connects. The code expires after about
30 minutes; **Cancel** stops the polling. Chat keeps working anonymously while you sign in.

#### 2.4 What is requested and what is read

- Scope: `user:read:chat` only. NeonStage never posts, deletes or moderates on your behalf.
- Read: `channel.chat.message`, `channel.chat.message_delete`, `channel.chat.clear`,
  `channel.chat.clear_user_messages` for the channels your widgets ask for.
- Badges come from the global and channel badge sets; emote images come from `static-cdn.jtvnw.net`.

#### 2.5 Token storage and expiry

- Access token: about 60 days, refreshed automatically before it expires.
- Refresh token: single use. Every refresh returns a new one and NeonStage stores it immediately. An unused
  refresh token expires after 30 days.
- If Twitch rejects a refresh, the tokens are deleted and the provider falls back to anonymous read-only
  chat, so the overlay keeps working without a sign-in.
- Tokens are encrypted with Electron `safeStorage` (DPAPI on Windows) in `secrets.dat`. If OS encryption is
  unavailable they are kept in memory only and you reconnect after a restart.
- **Sign out (back to anonymous)** revokes the token at Twitch, deletes it locally, closes the EventSub
  connection and moves every Twitch source back to anonymous IRC.

#### 2.6 Limits

- One shared EventSub WebSocket for every Twitch source in the project.
- Twitch allows 3 WebSocket connections per user token and 300 subscriptions per connection. NeonStage uses
  four subscriptions per channel, so roughly 75 channels fit in one session.
- Subscriptions are created when a widget asks for a channel and deleted when the last widget releases it.
- Keepalive: if Twitch sends nothing for `keepalive_timeout_seconds + 5`, NeonStage reconnects with
  exponential backoff (1, 2, 4, 8 ... capped at 60 s, with jitter).
- A `session_reconnect` message moves the session to the new URL without recreating subscriptions.


1. Open <https://dev.twitch.tv/console/apps> and sign in with the Twitch account whose chat you want to read.
2. **Register Your Application**.
3. Name: anything you like (for example `NeonStage`).
4. **OAuth Redirect URLs**: `http://localhost` — the form requires a value, but the device code flow never
   uses it.
5. Category: any.
6. **Client Type: Public**. A public client has no client secret, which is what the device code flow needs.
7. Create, then copy the **Client ID**.

### 2. Paste the Client ID into NeonStage

Connections → Twitch → Client ID → **Save**. Changing the Client ID later signs you out, because the old
token belongs to the old application.

### 3. Sign in with a device code

Press **Connect Twitch**. NeonStage asks Twitch for a device code and shows an eight-character code plus
<https://www.twitch.tv/activate>. Open that page, enter the code, approve the app. NeonStage polls Twitch
every few seconds until you approve, then stores the tokens and connects. The code expires after about
30 minutes; **Cancel** stops the polling.

### 4. What is requested and what is read

- Scope: `user:read:chat` only. NeonStage never posts, deletes or moderates on your behalf.
- Read: `channel.chat.message`, `channel.chat.message_delete`, `channel.chat.clear`,
  `channel.chat.clear_user_messages` for the channels your widgets ask for.
- Badges come from the global and channel badge sets; emote images come from `static-cdn.jtvnw.net`.

### 5. Token storage and expiry

- Access token: about 60 days, refreshed automatically before it expires.
- Refresh token: single use. Every refresh returns a new one and NeonStage stores it immediately. An unused
  refresh token expires after 30 days.
- If Twitch rejects a refresh, the provider shows **Signed out** with "Twitch sign-in expired — connect
  again." and the sources go offline.
- Tokens are encrypted with Electron `safeStorage` (DPAPI on Windows) in `secrets.dat`. If OS encryption is
  unavailable they are kept in memory only and you reconnect after a restart.
- **Sign out** revokes the token at Twitch, deletes it locally and closes the chat connection.

### 6. Limits

- One shared EventSub WebSocket for every Twitch source in the project.
- Twitch allows 3 WebSocket connections per user token and 300 subscriptions per connection. NeonStage uses
  four subscriptions per channel, so roughly 75 channels fit in one session.
- Subscriptions are created when a widget asks for a channel and deleted when the last widget releases it.
- Keepalive: if Twitch sends nothing for `keepalive_timeout_seconds + 5`, NeonStage reconnects with
  exponential backoff (1, 2, 4, 8 … capped at 60 s, with jitter).
- A `session_reconnect` message moves the session to the new URL without recreating subscriptions.

## YouTube

### 1. Create a Google Cloud project

1. Open <https://console.cloud.google.com/> and create (or pick) a project.
2. **APIs & Services → Library → YouTube Data API v3 → Enable**.

### 2. Configure the OAuth consent screen

1. **APIs & Services → OAuth consent screen**.
2. User type: **External**. Fill in the app name and your email.
3. While the app stays in **Testing**, add your own Google account under **Test users**. Only test users can
   sign in.
4. Testing-mode refresh tokens expire after **7 days**. You will have to press **Connect** again weekly
   until the app is published.

### 3. Create a Desktop OAuth client

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Desktop app**.
3. Copy the **Client ID** and **Client secret**.

### 4. Paste them into NeonStage

Connections → YouTube → Client ID, Client secret, minimum poll interval → **Save**. The secret is stored in
the encrypted secret store and is never sent back to the editor; settings only report whether a client is
saved. Changing either value signs you out.

### 5. Sign in

Press **Connect**. NeonStage starts a temporary loopback listener on `127.0.0.1` (random port), opens the
Google consent page in your browser with a PKCE `S256` challenge and a random `state`, and waits up to five
minutes. The browser lands on a small "you can close this tab" page. The authorization code is exchanged in
the main process; the code, verifier and tokens never leave it.

Scope: `https://www.googleapis.com/auth/youtube.readonly`. NeonStage only reads.

### 6. Broadcast resolution

- `youtube:mine` (the widget default) asks `liveBroadcasts.list` for the authorized user's active broadcast
  and uses its `liveChatId`. If nothing is live, the source shows "No active broadcast — retrying every
  60 s" and retries once a minute while the widget exists.
- `youtube:video:<id>` asks `videos.list` for `liveStreamingDetails.activeLiveChatId`. A video without an
  active chat shows "This video has no active live chat".
- Both forms share one poller when they resolve to the same live chat, so you never pay twice for the same
  chat.

### 7. Quota math

- `liveChat/messages.list` costs **5 units** per call.
- The default daily quota is **10,000 units**, i.e. about **2,000 polls per day**.
- NeonStage waits `max(pollingIntervalMillis, minimum poll interval)` between polls. The minimum defaults to
  5 s and can be set from 2 s to 120 s in Connections.
- At a 5 s interval chat lasts roughly 2.8 hours of continuous polling per day; the Connections panel shows
  the estimate for the interval you pick.
- When the quota runs out the provider switches to **Error** with "YouTube API daily quota exhausted —
  resets at midnight Pacific time" and polling stops until the next day.
- `rateLimitExceeded` doubles the interval instead of stopping; `liveChatEnded`, `liveChatNotFound` and
  `liveChatDisabled` put the source offline with a short reason.

## Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| Twitch source stays "connecting" | The IRC socket never confirmed the join, or the channel is quiet | Check the channel name and the network/proxy, then press Reconnect |
| "Twitch channel 'x' was not found" | Login typo, or the channel does not exist | Fix the channel name in the widget |
| "Twitch channel 'x' is suspended" | Twitch has suspended that channel | Use another channel |
| "Enter a channel name (or sign in to use your own channel)" | The widget is on `@me` and you are not signed in | Type a channel name, or sign in with your own Twitch app |
| Twitch source goes offline after a while | Twitch closed the anonymous socket or rate limited the joins | Press Reconnect; keep the number of anonymous channels small |
| Twitch device code is rejected | Client type is Confidential, or the Client ID is wrong | Recreate the app as a **Public** client and save the new Client ID |
| Sign-in silently returns to anonymous | Refresh token rejected, unused for 30 days, or the app was deleted | Press Connect Twitch again in the Advanced section |
| Twitch source stays "connecting" after sign-in | The EventSub WebSocket never sent `session_welcome` | Check the network/proxy, then press Reconnect |
| Twitch source goes offline after a while when signed in | Subscription revoked by Twitch | Press Reconnect; check the app is still authorised |
| YouTube shows "Not set up" | Client ID or secret missing | Save both values from the Desktop OAuth client |
| "YouTube sign-in expired — connect again (Testing-mode apps expire after 7 days)" | Testing-mode refresh token expired, or access revoked | Press Connect again, or publish the consent screen |
| "YouTube API daily quota exhausted" | 10,000 units used (about 2,000 polls) | Wait for midnight Pacific time or raise the minimum poll interval |
| "No active broadcast — retrying every 60 s" | Nothing is live on the authorised channel | Start the broadcast; the widget picks it up within a minute |
| "This video has no active live chat" | The video is not live, or chat is disabled | Use the live broadcast or enable chat |
| "Live chat ended" | The broadcast stopped | Nothing to do; the source returns when a new chat starts |
| Sign-ins disappear after restart | OS encryption unavailable, so tokens are memory-only | The Connections panel warns about this; reconnect after each start |

## Tested vs untested

Verified with automated tests (`tests/providers-twitch.test.ts`, `tests/providers-twitch-irc.test.ts`,
`tests/providers-youtube.test.ts`) using mocked `fetch`, mocked WebSocket and fake timers — no network calls:

- Anonymous IRC: tag parsing and unescaping, emote segmentation by code point (including a surrogate pair
  before an emote), `/me` ACTION, `CLEARCHAT` / `CLEARMSG` / `USERNOTICE`, `PING` → `PONG`, `RECONNECT`
  reconnecting and rejoining, exponential backoff on close, and the socket closing when the last channel
  leaves.
- Adapter routing: anonymous IRC when not signed in, EventSub when signed in, back to IRC after sign out,
  `@me` offline without a sign-in, status `mode` and state, and no token ever written to the IRC socket.
- Twitch device code polling: `authorization_pending`, `slow_down` interval increase, success.
- Twitch refresh-token rotation and the fallback to anonymous mode when a refresh is rejected.
- Twitch `session_welcome` → four subscriptions with the expected condition and transport.
- Twitch chat message mapping (emote URL, badges, colour, sanitised text) and the delete / clear /
  clear-user ops.
- Twitch `session_reconnect` keeping subscriptions, and the keepalive watchdog reconnecting.
- One shared socket and one subscription set for two widgets on the same channel, and subscription deletion
  on release.
- YouTube PKCE `S256` challenge matching the verifier, and rejection of a mismatched `state`.
- YouTube polling interval floor, first-backlog trimming to 20, deleted/banned ops, quota exhaustion, shared
  poller for two sources on one live chat, and no tokens or secrets in status.

Untested without real credentials (all live network paths):

- The real anonymous IRC socket against Twitch: join limits, message volume, `RECONNECT` and the 6-minute
  watchdog were only exercised against a fake WebSocket.
- The real Twitch device-code approval, Helix responses and EventSub WebSocket traffic.
- The real Google consent screen, loopback redirect in a browser, code exchange and revoke.
- Real YouTube Data API responses, quota accounting and `pollingIntervalMillis` values.
- OS-backed `safeStorage` encryption of the token blobs on a real Windows profile.
