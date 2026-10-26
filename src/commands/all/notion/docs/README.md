---
created: 2026-10-24
updated: 2026-10-25
---

# notion — Notion commands

- `notion:find` searches the connected workspace for pages and databases.
  The chat gets the matches as fields (title, link, id, where each sits, the words around the match);
  the terminal prints one per line.
- `notion:read` reads one page, database or view in Notion's markup, 40k chars per call.
  Notion answers with JSON that wraps the page; the command hands on the page's own text, with its title, link,
  the pages above it and its last edit as fields, so the chat reads it unescaped and the pager counts real text.
  It shares the pager in `commands/lib/chat/readPage.ts` with `google:read`, so both cut long reads the same way.
- `notion:new` creates a page: private, under a page, at the top of a teamspace, or as a row in a table.
- `notion:table:new` creates a table (a Notion database) on a page or private, with its first rows if given.
- Links drop Notion's `pvs` tracking parameter; Notion's links are `app.notion.com/p/<id>`.
- `notion_find` and `notion_read` are auto-approved ai:chat tools.
  `notion_new` and `notion_table_new` ask first, and their cards show what will be made.
  The chat prompt steers Notion links and Notion requests to these tools instead of the browser.
- Connecting lives on Settings → Connections → Notion: `web/client/settings/settingsNotion.tsx`,
  routes under `/notion` in `service/handler/settings/connections.ts`.
- The plumbing is `#lib/notion`: the sign-in (`oauth.ts`), the keychain entry `notion/workspace` (`secrets.ts`),
  and the client (`client.ts`).

## How Sky signs in

Sky reaches Notion through the MCP server Notion hosts for AI apps (`https://mcp.notion.com/mcp`), not its REST API.
The sign-in decided it: the person presses Connect, allows Sky on Notion's own page, and is done.

The server's sign-in fits an app that runs on the person's Mac and whose code is public:

- Sky registers itself on the spot (dynamic client registration) as a public client, so there is no secret to keep.
- PKCE protects the code; the redirect lands on the service's loopback receiver, as Google's and Beeper's do.
- The grant comes with a refresh token, so it renews itself.
- It acts as the person and sees what they can see, with no pages to pick.

Checked 2026-10-24: the server's `/.well-known/oauth-authorization-server` lists registration, `none` as a token
auth method, `S256` and the `refresh_token` grant; a registration with a `127.0.0.1` redirect answered 201, and
the approval URL answered 302 on to Notion's own approval.

Set aside:

- **Personal access tokens.** Pasted by hand and expire within a year. On Free and Business plans only workspace
  owners can make one unless an admin allows members, and guests never can. That shuts out the regular team member.
- **The REST API's sign-in (a public connection).** The code exchange and every renewal need a client secret.
  Sky's code is public, so Sky would have to run a server just to hold it, and people pick pages one by one.
- **Internal integrations.** Owner-only, and every page has to be shared with the integration by hand.

What it costs:

- Notion labels the server beta and changes its tools often. Their names live in `lib/notion/client.ts` alone,
  and Sky's commands wrap them, so a rename on Notion's side is one edit there.
- The grant is good for the MCP server only, so every Notion request goes through its tools.
- Enterprise admins can limit which AI apps connect; such a workspace has to approve Sky first.

## Calls

- A client opens one session: `initialize`, `notifications/initialized`, then `tools/call`.
  Notion answers with JSON or an event stream; progress notes in the stream are skipped.
  A session Notion forgot (404) is opened again once.
- An expired token, or a 401, is renewed once with the refresh token, and the keychain keeps the newest grant.
  Calls that hit the same refusal share one renewal, and a grant another Sky process renewed is taken from the
  keychain instead of renewing again.
- A disconnect wins: with no grant in the keychain a renewal fails as not connected and never saves one back.
- Disconnect removes the keychain entry, then hands the refresh token back at Notion's revocation endpoint.
  That last step is best effort.

## Creating

`notion:new` takes one `parent` in plain words, and works out what it names:

- Nothing: a private page, through Notion's draft mode (`creation_mode: "draft"`), which Notion prefers to
  leaving the parent out.
- A link or id: Sky fetches it first, as Notion's tool asks, because a table needs a different parent than a page.
  A page becomes the parent page.
  A table's rows go to its data source (`collection://…`), and the title goes in the table's own title column,
  named in the JSON state Notion sends with the table.
  A table with more than one data source fails and lists them, and the chat passes the one it means.
- Other words name a teamspace, looked up by name: an exact name wins over a partial match,
  and one the person is in wins over one they are not.
  No match lists the person's teamspaces.

`notion:table:new` hands Notion's own column syntax through, wrapped in `CREATE TABLE (…)`.
The chat writes that syntax better than any shape Sky could invent, and the tool description lists the types.
A table goes on a page or private, never at the top of a teamspace:
Notion's create-database tool takes only a page as parent, and its move tool cannot reach a teamspace's top.
The chat makes a page there first.
Rows are added in calls of up to 100, Notion's limit.
If Notion refuses rows after the table exists, the failure names the table and its link,
so the chat doesn't make it again.

The body is Notion-flavored Markdown: plain Markdown, plus Notion's own tags for callouts, toggles, tabs and columns.
The chat reads the spec only when it needs those tags, by passing `notion://docs/notion-flavored-markdown-spec`
to `notion:read`, so the spec costs nothing on other turns.

A tool Notion refuses often answers with a JSON error; the client passes on the `message` inside it.

## Not built

- Editing, moving or deleting pages, and comments.
- Creating a teamspace: Notion's tools have none.
- Adding many rows to an existing table in one go; `notion:new` adds one row at a time.
- More than one workspace at a time; connecting again replaces the grant.
- Copying Notion pages into the notebook.
