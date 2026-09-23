---
created: 2026-09-22
updated: 2026-09-22
---

# Google Cloud setup — Sky does the console

Connecting a Google account used to start with ten minutes in the Google
Cloud console: a project, six APIs, a consent screen, a publish, an OAuth
client, and a client ID and secret pasted into Sky. `lib/google/cloudSetup/`
does that part for the person. What they do is sign in and tick the boxes.

Google has no API for creating an OAuth client — the console is the only
way — so Sky drives the console in a real browser window. The window is the
person's: they sign in, Sky never sees the password, and everything Sky
makes lives in their own Google account. The client pair goes from
Google's dialog straight into the OS keychain; Google shows the secret only
once, and no file ever holds it.

## The run

`startCloudSetup()` in `run.ts` opens a window on a profile of its own
(`~/.sky/google-setup-profile`, never the workspace agent's automation
profile) and walks:

1. **Sign in** (`signIn.ts`) — the person's. Sky waits for the console to
   appear. A first visit asks for the Cloud terms; Sky ticks the box, because
   the person agreed on Sky's start screen before the window opened.
2. **Project** — `console.cloud.google.com/projectcreate`, named "Sky
   Notebook" (`APP_NAME`; the console wants 4 to 30 characters). The id is
   read off the form and off the URL the console lands on.
3. **APIs** — one page switches on all six (`flows/enableapi?apiid=…`);
   the list is `GOOGLE_APIS` in `../setup.ts`, kept beside `GOOGLE_SCOPES`.
4. **Branding** — Google Auth Platform's "Get started" wizard: app name
   "Sky Notebook", the account as support and contact email, audience
   External, the User Data Policy box (agreed to on the start screen too).
5. **Publish** — to production. In Testing every grant dies after 7 days.
6. **Client** — a Desktop app client. The "OAuth client created" dialog is
   read for the pair, which is saved as `google/client:<projectId>` at once.
7. **Consent** (`consent.ts`) — Google's permission page in the same
   window, with the loopback receiver `sky google:auth` uses. Sky clicks
   past the "unverified app" warning itself (the client is the person's
   own, made a minute ago); the person ticks the boxes. The tokens are saved
   naming the client that issued them and the project that was set up.

Steps 2–6 are `consoleSteps.ts`. Each one looks before it acts and checks
after, so a run that stops halfway picks up where it stopped: the profile
keeps the sign-in and `~/.sky/google-setup.json` keeps the project and the
steps done (`resume.ts`). Both go away when a run finishes.

## When Sky cannot do a step

The console is redesigned often. Everything is found by role and visible
text (`page.ts`), and every page is asked for in English, but a button
will move one day. When a step's anchor is missing, the run does not die:
the step becomes the person's. The checklist shows the written step (the
same line `sky google:auth --manual` prints), the person does it in the
window, presses Continue, and Sky looks again (`verify`). A screenshot and
the page's accessibility tree land under `/tmp/sky/logs/google-setup/` so
the next fix is made from what the console showed — except for the client
step, whose dialog holds the secret.

## What reads the run

- `state.ts` is the checklist as the page and the terminal see it: the
  phases with `todo`/`doing`/`done`, a `needsYou` with the message for the
  person (and the instruction, when it is theirs to do), then `done` with
  the account or `failed` with why.
- `sky google:auth` runs it in the terminal when no client is stored, or on
  `--setup`; `--manual` is the old walkthrough and paste.
- The settings service runs it from Google's page under Connections
  (`service/handler/settings/createConnectionsHost.ts`, routes
  `/google/setup…`), one run at a time; the page polls it every second.
  Every account added from the page gets a run of its own: a pair one
  account granted to may be shut to another (a workspace client restricted
  to its organization answers `org_internal` on Google's page, where Sky
  cannot see it), so the page never signs a new account in with an old
  pair. Only Connect again does, with the pair that already served that
  account.

## Client pairs, per account

`../tokens.ts`: the shared, hand-pasted pair stays `google/client`; a pair
Sky made is `google/client:<projectId>`. An account's tokens name the pair
that issued them (`client`), absent meaning the shared one, and carry
`setup` when Sky made the Google Cloud side. `loadAccountClient` is the one
rule every caller uses; a plain sign-in for a new account takes
`loadDefaultClient` (shared first, else the first pair Sky made — any
Google account may grant to those).

## Not done, and why

- The console selectors have not been run against the real console yet;
  the first live run is the proof, and the fallback above is what makes a
  wrong selector a pause rather than a failure.
- A shared, Google-verified client (Connect in ten seconds, no window) is
  the mainstream answer for later. It needs Google's verification for the
  restricted Gmail scope, which takes weeks; unverified it is capped at 100
  accounts for life. The private-connection run is what ships now.
