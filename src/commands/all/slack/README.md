---
created: 2026-01-18
updated: 2026-08-27
---

# Slack Tasks

Run `nb cli:commands | grep slack` to see all available Slack commands.

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

`slack:draft:list`, `:clear`, `:reply`, and `:new` wrap `agent-slack message draft
list | delete | create` — Slack-native drafts through the undocumented `drafts.*`
client endpoints, in agent-slack since its July 2026 source (a February build
predates them; run the checkout from source). What sky adds: readable rows with
Grid-correct names and links, a clear-all that keeps scheduled sends, and the
two ai:chat tools with approval cards. Facts the wrappers lean on:

- Drafts are organization-scoped on Enterprise Grid: a team URL answers
  `team_is_restricted`, so sky passes `slack.workspace` (the enterprise URL) as
  `--workspace`.
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
