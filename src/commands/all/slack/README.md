---
created: 2026-01-18
updated: 2026-10-14
---

# Slack Tasks

Run `nb cli:commands | grep slack` to see all available Slack commands.

Saved message boundaries and layout compatibility are owned by the [Slack conversation parser](../../../_shared-ts/models/Message/slack/docs/README.md).

## Authentication and background checks

`lib/connection.ts` owns authentication for CLI calls, direct API requests and
Settings. Ordinary operations read only the selected workspace's credentials
through Sky's [noninteractive Keychain helper](../../../lib/secrets/docs/README.md).
They never launch browser import or an interactive Keychain read. A denied
read or rejected session persists a workspace pause under Sky's machine-local
`state/slack/connection` directory. Service restarts and subsequent checks honor
that pause; network failures instead have a short cooldown. Connections shows
Reconnecting and refreshes silent status checks until connectivity returns;
authentication recovery remains explicit. These state files
contain status and a revision, never tokens or cookies. Revision checks prevent
an older request from overwriting a newer pause or successful recovery.

The unchanged agent-slack loader eagerly reads every workspace from Keychain
even when `SLACK_TOKEN` is supplied. Environment variables alone therefore
cannot prevent macOS dialogs. On macOS, `lib/protectedProcess.ts` launches it
inside a child sandbox denying the `security` executable, Keychain IPC and
Apple Events, with the selected credentials in environment variables. Setting
`SLACK_TOKEN` also disables agent-slack's automatic refresh. There is no
unrestricted fallback: if macOS removes or refuses `sandbox-exec`, Slack pauses
until Sky gains another protected execution mechanism. The other Sky processes
and third-party checkout are unaffected.

Settings → Connections → Slack shows the pause and offers Restore access;
`sky slack:auth` performs the same explicit recovery. Recovery first tests the
saved session, restoring native Keychain access only when needed. Only missing
or rejected credentials lead to `agent-slack auth import-brave`. That deliberate
import can request macOS approval and requires a signed-in Slack tab in Brave.
Cancellation leaves the pause in place. Concurrent recovery requests join one
attempt; background callers remain paused. `sky slack:auth --check` always stays
noninteractive. The shell reports pauses from metadata without reading secrets.
Its recovery link selects the affected workspace, including one other than the
configured default. `sky slack:auth --workspace <workspace-url>` targets the same
recovery from the CLI.

The native sandbox regression test is opt-in (`SKY_SLACK_SANDBOX_TESTS=1`)
because macOS cannot apply a child sandbox from inside some development
sandboxes. It invokes `security help` only, so a regression cannot read a real
credential or request authentication.

## API Limitations: Bulk Unread Counts

**There is no efficient way to get unread message counts via Slack's OAuth API.**

### What We Tried

| Approach | Result |
|----------|--------|
| `users.conversations` | Provides conversation state (`last_read`, `latest`, sometimes DM unread metadata) |
| `conversations.list` | Does not include `unread_count` |
| `conversations.info` | Can provide extra detail, but **too expensive per conversation** |
| `client.counts` | Blocked: `not_allowed_token_type` (internal API) |
| `client.boot` | Blocked: `not_allowed_token_type` (internal API) |
| `users.counts` | Blocked: `not_allowed_token_type` (internal API) |
| `rtm.start` | Deprecated; no longer returns unread counts |
| `search.messages` with `is:unread` | Requires `search:read` scope; may not work |

### Why This Limitation Exists

Slack intentionally removed bulk unread counts from public APIs:

> "As of July 2017, the `unread_count` and `unread_count_display` channel fields are **no longer returned** [in rtm.start], though they can still be found in `conversations.info`."
> — [Slack Changelog (2017)](https://api.slack.com/changelog/2017-04-start-using-rtm-connect-and-stop-using-rtm-start)

> "rtm.start started behaving exactly like rtm.connect on September 27, 2022"
> — [rtm.start Deprecation](https://docs.slack.dev/changelog/2021-10-rtm-start-to-stop/)

The efficient bulk APIs (`client.counts`, `client.boot`) are reserved for Slack's own web/desktop clients and require internal session tokens, not OAuth tokens.

### How Slack's Own Clients Work

Slack's web app uses undocumented internal APIs:
- `client.boot` - Returns workspace overview on startup
- `client.counts` - Returns unread counts for all channels/DMs in one call

These require authentication via browser session cookies, not OAuth tokens.

### How OSS Slack Clients Handle This

Open source clients like [Wey](https://github.com/yue/wey) either:
1. Use **legacy tokens** (Slack stopped issuing these in May 2020)
2. Use **RTM WebSocket** to track unreads in real-time (requires classic app + RTM scopes)
3. **Embed the Slack web app** and extract data from browser context

### Current Implementation

`slack:unread` works around these limitations by:
1. Trying `search.messages` with `query=is:unread` (closest to Slack client behavior)
2. Falling back to conversation scans when `search:read` is not available
3. Fetching all conversations via `users.conversations` (paginated)
4. Using `conversations.info` + `conversations.history` on recent conversations when unread metadata is missing
5. Returning unread messages by timestamp comparison (`message.ts > last_read`) while filtering known noisy/system message types

This remains bounded by Slack API rate limits and may not perfectly match Slack client UI state in every workspace configuration.

### Required OAuth Scopes

For `slack:unread` to work, your Slack app needs these User Token Scopes:

- `channels:read` - List public channels
- `channels:history` - Read public channel messages
- `groups:read` - List private channels
- `groups:history` - Read private channel messages
- `im:read` - List DMs
- `im:history` - Read DM messages
- `mpim:read` - List group DMs
- `mpim:history` - Read group DM messages
- `users:read` - Resolve user names
- `search:read` - Query `is:unread` via `search.messages` (recommended)

### References

- [conversations.info API](https://api.slack.com/methods/conversations.info) - Only way to get `unread_count`
- [users.conversations API](https://docs.slack.dev/reference/methods/users.conversations) - Lists conversations without unread counts
- [RTM API Deprecation](https://docs.slack.dev/changelog/2021-10-rtm-start-to-stop/) - Why rtm.start no longer works
- [Slack Changelog 2017](https://api.slack.com/changelog/2017-04-start-using-rtm-connect-and-stop-using-rtm-start) - When unread counts were removed
- [Wey Slack Client](https://github.com/yue/wey) - OSS client using RTM
- [Unread Buddy Article](https://medium.com/@taylorhughes/get-gpt-3-to-read-your-slack-so-you-dont-have-to-2482fd2f8fdf) - Uses embedded browser approach

## Drafts

`slack:draft:list`, `:clear`, `:reply`, `:new`, and `:update` wrap `agent-slack
message draft list | delete | create | update` — Slack-native drafts through the
undocumented `drafts.*` client endpoints, in agent-slack since its July 2026
source (a February build predates them; run the checkout from source). What sky
adds: readable rows with Grid-correct names and links, a clear-all that keeps
scheduled sends, and the draft ai:chat/voice tools with approval (`:update` is
the revision loop: same draft, full replacement text). `slack:unread` is also a
tool now, returning each message with a link `slack:draft:reply` accepts. Facts
the wrappers lean on:

- Drafts are organization-scoped on Enterprise Grid: a team URL answers
  `team_is_restricted`, so sky passes `slack.workspace` (the enterprise URL) as
  `--workspace`.
- agent-slack cannot resolve channel *names* on a Grid — name targets (and
  `channel list`) answer `enterprise_is_restricted`; conversation ids work.
  `slack:draft:new` therefore resolves names itself over the user token
  (`lib/resolveChannelName.ts`): a unique exact name resolves to its id, near
  matches come back as a question ("close matches: … Say which one"), and
  `slack:api:channels` (now a tool, rows carrying ids) is the lookup surface.
- `drafts.list` caps at 100 with no cursor, and agent-slack has no paging either;
  `clear` re-lists after each page until nothing new comes back.
- A thread reply is a draft whose destination carries `thread_ts`; `create` takes
  `--thread-ts`. A delete must echo the draft's `last_updated_ts`; sky passes it
  from the list so the CLI needn't re-list to find it.
- `create` options go first and `--` closes them, so a body starting with a dash
  (a list) is never read as a flag.
- Draft `text` keeps mentions in wire form (`<@U…>`, `<#C…>`, `<!subteam^S…>`,
  `<!here>`); `channel_name` on a destination is best-effort (channel name, DM
  partner's display name, or an mpdm slug).
