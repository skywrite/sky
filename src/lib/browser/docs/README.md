---
created: 2026-09-25
updated: 2026-10-05
---

# Sky's browser

Sky can do things in a real browser window on the person's behalf: open a
site, sign in with their help, find what the task names, download files and
check them, upload files, fill forms. One command carries it today:

```
sky browser:task "Log in to my brokerage and download my 2025 tax forms to ~/Desktop/Taxes/"
```

The person watches the window. A saved existing-Brave connection takes precedence
for ordinary browser tasks. Mac tasks and tasks with a configured password
manager otherwise use the persistent Sky browser described below. Other platforms without saved
password managers retain the existing shared browser. Unsupported sign-in steps and codes unavailable in the approved login pause for the
person; Enter means "done, look again". Nothing on a web page is an instruction.

## Existing Brave

Settings → Browser automation can select the person's everyday Brave profile.
The person installs Microsoft's Playwright extension in that profile and supplies
its connection token. `existing/settings.ts` stores the token in the OS Keychain
as `browser/playwright-extension`; `~/.sky/browser/connection.json` holds only
machine-local browser/profile preferences. Reading Settings never reads the token
or connects a browser. Saving the connection is an explicit grant to use existing
website sessions for requested browser tasks, including across task restarts.

The same task worker connects through Playwright's official extension relay.
Each connection gets a tab group, and Sky creates its own page rather than
navigating a pre-existing tab. Cleanup closes only its task pages and disconnects
the relay; it never quits Brave, copies cookies, acquires the personal profile's
lock, or edits that profile's preferences. A failed connection reports how to
reconnect; it must not silently open a new, signed-out browser. Dedicated batch
imports and explicit test profiles keep their separate browser lifecycle.

Existing sessions require no credential lookup or per-site native approval. When
a site needs fresh authentication, `sign_in` uses the same 1Password broker and
run authorization described below. Unsupported forms, passkeys, and verification
without a saved code still need the person in Brave. The model still
cannot read credential fields, execute page scripts, export browser storage, or
choose unrelated tabs. Uploads retain the exact staged-file and destination checks.

The official extension allows a tab debugger, but rejects the browser-level
attachment used by `newCDPSession`. `existing/connection.ts` contains the narrow
adapter to Sky's pinned Playwright MCP factory and its already-connected tab
protocol. Sky owns Fetch interception on that tab, including every redirect;
Playwright routing must not also consume those interception events. Downloads
are captured from response streams or generated download links into the task's
folder. Never change the everyday profile's global download directory to make
this work. Download capture is bounded at 100 MiB and failures are reported.
Native downloads that bypass those hooks are tracked through the owned tab's
`Page.downloadWillBegin` and completion events. `existing/nativeDownloads.ts`
uses `downloadLocations.ts` to read the selected profile's download preference
and include Desktop, Downloads, and the task folder. With no selected profile,
all available profile download preferences are included. Locations are deduplicated
after resolving aliases; an unavailable folder does not prevent checking the others.
The tracker records each folder's initial files and copies only an unambiguous new completed file matching the announced
name and byte count. It preserves browser originals and passes bytes through the
same credential redaction checks. The extension forbids browser-level download
commands, including `Page.setDownloadBehavior`; changing global preferences is
not a workaround. Unknown save locations, ambiguous files and incomplete downloads
remain explicit collection failures, with the checked folders and access failures.
The parent chat's `find_downloads` uses the same preference discovery, adds requested
destination folders, and lists candidates from earlier attempts with timestamps
and incomplete-download markers. It does not connect to the browser, read secrets,
or expand the browser worker's file tools. Chat must open candidates to verify their
contents before organizing them; an empty task folder proves nothing about the rest
of the disk.

Changing the pinned Playwright version requires the opt-in
`existing/connection-e2e_test.ts` against an unpacked official extension. It uses
only temporary profiles and synthetic sessions/documents, verifying reconnect,
PDF collection, upload restrictions, redirect blocking, and cancellation without
quitting the original browser. The installed extension and Brave must remain
compatible; this adapter deliberately fails instead of falling back to a new profile.

Before sending input, the worker activates its own task tab. With the official
extension, a background tab can time out on a click and then leave Chromium's
wheel-event acknowledgment pending indefinitely; Playwright's wheel API has no
action timeout. A browser-action deadline retires an unresponsive page, and
`signIn/recovery.ts` reconnects inside the same credential worker. It preserves
the run's native grant and downloaded files, reopens the last observed HTTPS
origin/path, and requires a fresh inspection before any uncertain input is
repeated. Only a read-only snapshot is retried automatically. Recovery is bounded
to two connections per task; native authentication keeps its own approval deadline.
The Jev runner rechecks the page after model reasoning and before sending input.
A delayed SPA navigation or replacement of the controls invalidates the old
decision before the input is sent.

## Credential-backed tasks

`signIn/worker.ts` owns the 1Password SDK in a separate process and connects
either to existing Brave or to a Playwright browser it owns. **Sky's browser profile and website sign-ins persist across tasks,
pauses, retries, and service restarts.** Task cleanup closes the browser and
releases access; it must never delete the profile or treat cancellation as sign-out.
This is a product requirement, also recorded in the root `AGENTS.md`.

The task communicates over inherited pipes using a small MCP-compatible
allowlist. There is no HTTP/CDP listener or persisted credential-use approval.
Both the reasoning-model and Jev runners
use this worker on macOS, including when no password manager is configured. The
legacy shared driver is never attached to a credential-backed task, including
after a crash. Existing legacy sessions are not imported or changed.

`signIn/profile.ts` leases the stable, owner-only `~/.sky/browser/private-profile/`
directory on this Mac, outside the notebook and its data directory. Concurrent workers wait for its current owner;
they never fall back to a fresh profile or terminate an active task's browser.
A dead worker's lease and orphaned Chromium process can be recovered while
keeping the profile. The profile retains cookies, local storage, IndexedDB, and
extension state. Chromium drops session-only cookies on exit even with a
persistent profile, so the worker also checkpoints those cookies atomically in
an owner-only file inside that profile after actions and before closing. They
are restored inside the next worker, never returned through tools or placed in
task downloads. An explicit website sign-out replaces the checkpoint with the
remaining cookies; it must not resurrect the old session. Website expiry still
applies. Keeping a signed-in session and authorizing credential use have separate
lifecycles; a model cannot use a saved profile as permission to read a password.

The only model-facing authentication operation is `sign_in({})`. It accepts no
URL, account, field selector, credential reference, or approval flag. Trusted
code captures the current document and a single unambiguous login, including
supported JavaScript controls in a visible same-website child frame. Ordinary tasks ask once, in a native macOS dialog, to use matching logins
throughout the current run. `CredentialRun` retains that approval and the SDK
clients inside the worker. A unique match permitted by the saved autofill scope is used automatically;
multiple matches or incomplete lookup still require the native login chooser.
Passwords are read freshly at each use, never cached for reuse. Dedicated imports
retain their independent, per-use authorization.

A live chat plan owns `PrivateBrowserRun`, an in-memory worker lease shared across
its browser subtasks and queued turns. Subtasks run in order and each gets a fresh
task tab, origin guard, OTP continuation, upload manifest, and download folder.
Finishing a subtask closes its tab but retains the worker and its SDK clients.
Finishing or pausing the plan, cancelling the turn, ending the chat, or losing the
host process ends the worker and revokes the grant. A verification handoff keeps
the run alive. Plan recovery contains neither the worker nor the approval; a
resumed or separate chat must obtain its own grant. Host lifecycle messages are
excluded from the tools exposed to the model.

[1Password authorization](https://www.1password.dev/sdks/desktop-app-integrations)
is per process and per account. Each connected account may need an initial desktop
approval. Locking 1Password or ten minutes of SDK inactivity expires its grant;
Sky does not keep it alive with background vault reads. Reusing the worker avoids
creating a new per-process authorization request for every site.

The native prompt is outside the Sky HTTP API and model tools; the caller cannot
answer it through a request. Cancellation does not become a remembered grant.
The service's `osascript` process must become an active AppKit accessory before
showing a dialog; a bare AppleScript `activate` can leave the prompt behind Brave
until it expires. A stopped sign-in retains its paused error and Resume control,
rather than creating a browser handoff after the task tab has closed.
After approval, the captured document and form must remain unchanged. A second
sign-in request on that origin ends the attempt rather than repeatedly submitting
a rejected login within the same browser subtask.

Lookup considers saved accounts and vault exclusions. Filling honors the saved
Login item's autofill scope: exact-host entries require that HTTPS host and port,
website-wide entries permit the same registrable domain and port, and never-fill
entries are excluded. `credentials/login.ts` uses the Public Suffix List including
private suffixes so unrelated hosted tenants cannot match. It does not infer
1Password's additional organization-to-organization aliases. After
selection, code rechecks account/vault preferences, the concrete document and
form action, then reads the login and revalidates its website from one native
item revision. Values stay inside the worker and go directly to Playwright
element handles. Public landing pages with one visible HTTPS sign-in destination
open that link before asking the person. If it changes the page without presenting
a supported form, `navigated` tells the driver to inspect the new page, not to claim
a password was submitted. The model otherwise receives `submitted`, `needs_user`, `declined`, or
`unavailable`, with a fixed reason and public website origin for a failed attempt.
Provider exceptions, account metadata, and credential values never enter that
explanation. A cancelled request, failed lookup, missing permitted website match, or
changed form ends the attempt and pauses a live chat plan with the reason. These
failures must not turn into a generic manual handoff: there may be no usable
sign-in left to complete. Both drivers stop and preserve the failure; pausing the run revokes its
credential approval. `needs_user` without a failure reason
still allows the person to complete a verification step in the browser.
Submission is not proof of authentication; the next snapshot
must show progress. Another task can reuse a saved website session. Credential approval carries only
across subtasks of the same active run, while OTP continuations remain single-use
and local to the current sign-in.

Credential delivery and page navigation have separate boundaries. Ordinary tasks
allow HTTPS GET/HEAD redirects with no request body or known login values, so an
inline sign-in can reach an account on another origin. Every redirect hop still
blocks credential-bearing URLs and cross-origin password/code bodies, including
307 POST replays. Scripted password logins have one narrow exception: a direct
XHR/fetch POST from the captured login origin to an HTTPS API on the same website
and port, permitted by the freshly read Login item's autofill scope. Exact-host
items do not grant other subdomains. This permission expires after two minutes
and is revoked when either captured document navigates; it never permits a
redirected credential body. Callback parameters join private redaction. This does not grant
permission to fill on the destination: each new form requires its own permitted saved
website match. Dedicated imports retain their pinned navigation policy, and file
uploads retain their exact-origin restriction. A blocked top-level navigation is
reported as a Sky restriction with its destination, not a password-manager outage
or a generic request to finish sign-in on the browser's error page.

This flow supports a visible username and current-password field in one
top-level, same-origin POST form with one submit control. `signIn/scriptedLogin.ts`
also captures one clearly labelled username, password and sign-in button without
an HTML form, or in a JavaScript form that omits action, method and target,
in the main document or a visible direct child frame on the same
HTTPS website. Both documents and the concrete controls remain bound across
approval and filling; a captured HTML form cannot be replaced or acquire submission
overrides. Its implicit native GET is suppressed before clicking so a broken
JavaScript handler cannot put credentials into the URL. Explicit GET forms,
hidden, ambiguous, registration and unrelated-frame controls remain
unsupported. LinkedIn's JavaScript
login has a separate, origin-and-path-bound adapter in `lib/linkedin/login.ts`:
its current login screen has no HTML form. That adapter captures the concrete
username, password and sign-in controls, revalidates them around native approval,
and installs the same network guard before filling. Username-first pages and
other unsupported forms use the native browser handoff below. Credential
delivery retains the captured origin even when ordinary navigation continues.
The worker combines Playwright routing with a private Chromium Fetch interceptor:
Playwright skips subsequent requests in an HTTP redirect chain, including 307
redirects that preserve a credential POST. The interceptor rechecks every hop
and tracks Network request IDs because Fetch can omit its redirect marker
when another Playwright interceptor is attached. It uses the existing browser pipe,
never a CDP listener.
Native approval currently requires macOS. Future workflows must extend the
authorization boundary, not inject a login into the shared localhost driver.

The worker offers ordinary navigation, accessible snapshots, control actions,
and downloads. Upload tasks additionally receive an exact staged file manifest
and HTTPS destination origin from the chat host. Only those files can enter a
file input or chooser on that origin; after selection, the network guard keeps
all requests and redirect hops on that origin. Sites requiring a separate upload
origin are consequently blocked and must be reported as incomplete. Selecting
files is not proof of upload: the driver must inspect the destination receipt.
Uploads use the reasoning driver because Jev's action table has no file chooser
operation. It offers no arbitrary JavaScript, console/network inspection,
storage/cookie export, screenshots, tab switching, or approval RPC.
Authentication pages stay hidden while password, username or one-time-code
entry is visible, including manual entry. URL query/fragment parameters are
omitted from page headers. Known login values and common encodings are redacted from text results;
download bodies and names containing them are withheld. No console log, snapshot,
video, or trace artifact is written by the worker. The task's `read_file` can read
only its downloaded files, including after symlink resolution. Cancellation
notifies and closes the worker; closing the task preserves its saved sign-ins.

### Apple Passwords, passkeys, and SSO

`sign_in({})` also supports a native browser handoff. The person authorizes the
original website and completes the website's own sign-in, including username-first
pages, enterprise SSO, passkeys, and external verification. Each additional HTTPS
identity-provider origin requires a native approval. A four-minute window permits
one private popup and up to eight provider origins. The worker rejects model
operations throughout the handoff. Completing a second native dialog resumes
only on the original site; cancellation, expiry, or returning elsewhere closes
that task's browser while retaining the profile. Completion means the person returned control, not proof of login.
LinkedIn uses this same handoff before resuming its pinned profile import.

The popup's first network request is aborted until its Chromium Fetch interceptor
is attached, then one GET is replayed. Redirect hops receive the same checks as
top-level requests; known passwords/codes cannot follow a cross-origin POST even
to an approved provider. OAuth/OIDC and SAML callback parameters stay inside the
worker and join result/download redaction. Page input/change/submit listeners
capture manual and extension-filled values for redaction. Do not read DOM values
from a paused navigation request: Playwright may wait for the very document whose
request is paused. This is defense against accidental reflection by trusted sites,
not a sandbox for malicious scripts on a user-approved site.

Apple Passwords uses Apple's official iCloud Passwords extension. Explicit setup
downloads the package and verifies the CRX3 signature against Apple's extension ID;
every launch rechecks it and extracts it at a stable path in Sky's own profile.
Neither the extension archive nor the preferences contain vault data. The browser
profile and extension state survive task cleanup; Apple can still require fresh
verification. Sky never copies the everyday
browser's cookies, extension storage, or passwords.

Passkeys use the website's actual WebAuthn request and the browser/macOS picker.
Sky neither exports private keys nor substitutes an authenticator. Apple Passwords
and 1Password can be selected through macOS AutoFill; 1Password must be enabled
there separately from its SDK connection. Registration and assertions remain
between the authenticator and the website, outside model tools.

The bundled Playwright Chromium on macOS is ad-hoc signed and lacks Apple's
[arbitrary-domain passkey entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.web-browser.public-key-credential).
An unentitled Swift helper or WKWebView cannot remove that restriction. Native
setup therefore explicitly selects the installed **Brave (Chromium)** build,
verifying its publisher signature and passkey entitlement before each launch.
It uses Sky's persistent profile, never the person's usual profile. The default browser
is unchanged until this choice is saved. Ordinary code-signature verification
accepts harmless Finder metadata which `--strict` can reject; it still checks
signed code and the pinned publisher requirement. No browser is re-signed.

See [Apple's extension setup](https://support.apple.com/120758) and
[1Password's macOS AutoFill support](https://support.1password.com/macos-autofill/).
Tests use virtual authenticators only as test fixtures; production never installs
one. Browser capability checks are not evidence of a successful real-account login.

### Verification continuation

After submitting the approved password, the broker can retain an in-memory,
single-use continuation for two minutes. It identifies only that login's one
TOTP field and native item revision. On the next snapshot or LinkedIn workflow
step, the worker can capture one empty code field and one submit button in a
same-origin, top-level POST form. It fetches a fresh code only then, checking the
account, vault exclusions, item revision, website, concrete document and controls
again before filling. The native prompt explicitly includes this code use.

Consuming the continuation precedes any provider read. There is no code tool,
API response, stored grant, fallback to another item, or automatic retry after a
rejected code. Cancellation, ordinary tool actions/navigation, or observing a
page without credential entry revokes the continuation. The model cannot reuse
it for a later transaction challenge. Known codes join password redaction and
the request/download guards before filling. Provider-supplied expiry is checked;
the 1Password SDK does not supply expiry, so its code is fetched at use time.

Missing/ambiguous authenticators, SMS/email/recovery challenges, already populated
fields, split boxes, embedded controls and unsupported forms stay with the person
in the browser. The worker hides verification controls even for manual entry;
handoff instructions never ask for a code in chat.

`bun run dev:test:browser:security` runs the worker, sign-in, code-continuation,
redirect and LinkedIn browser tests. The dedicated GitHub Actions job installs
the locked Playwright Chromium and runs these against synthetic sites with fake
provider/native approvals; it needs no account secrets or desktop password manager.
Chromium's sandbox remains enabled on the CI runner.

The destination website necessarily receives its password. This boundary trusts
the approved origin and its scripts; string redaction cannot make a malicious
same-origin application safe or recognize every encoding in arbitrary downloaded
documents. It also does not defend against arbitrary local code running as the
OS user. The guarantee here is separation from ordinary Sky API access, other
browser tasks, and the model's allowed tool surface. Legacy shared-browser tasks
remain outside this boundary. Settings stores preferences only; see the
[settings boundary](../../../service/handler/settings/docs/README.md#password-manager-setup-boundary).

## LinkedIn Person import

Person import starts this same private worker, scoped at initialization to one
canonical LinkedIn profile. In this mode the worker exposes only `linkedin_step`:
fixed workflow progress followed by scrubbed profile evidence. The job cannot
request general navigation, snapshots, downloads, credential reads, or an approval
decision. Website credentials and the authenticated browser stay inside the
worker; the normal People HTTP API still exposes only job progress and a draft.

`lib/linkedin/browser.ts` owns the deterministic flow: open the profile, use the
shared sign-in broker once if needed, complete supported saved-code challenges
or wait for the person to finish verification,
return from LinkedIn's feed to the selected profile, and capture its main content.
Ordinary automation is confined to `https://www.linkedin.com`; an independently
approved native SSO handoff may visit an identity provider and must return first. The import job closes
the browser before sending evidence to its extraction model. Completion, failure,
cancellation, or the five-minute deadline closes that job's browser while retaining
its saved sign-in for later jobs. The previous
persistent LinkedIn profile is neither read nor modified. No configured password
manager or a declined approval leaves manual sign-in available in the private
window. Other codes, passkeys and unsupported login variants still require the person.

## How a task runs

The legacy shared-browser path, retained on other platforms without a configured password manager:

1. `commands/all/browser/task.ts` makes a task folder and starts the run.
2. `lib/browser/mcp/browserDriver.ts` attaches the task to Sky's browser:
   Playwright's own MCP server, `playwright mcp`, from Sky's pinned
   Playwright, serving over HTTP on localhost, started once on Sky's one
   profile and left running with its window open. Each task opens a tab of
   its own and works there; the model never sees the tab tools, since the
   next tab may be another task's. A task that finishes closes its tab; one
   that stops or is killed leaves it where it was. The window and every
   sign-in in it stay for the next task. Five tasks at once are five tabs.
3. `lib/browser/mcp/client.ts` talks to it, standard MCP framing over HTTP
   (or over stdio, for a driver of one's own).
4. `lib/browser/mcp/tools.ts` turns the driver's tools into chat-engine
   tools. A screenshot reaches the model as an image, not as a filename. A
   download lands in the driver's folder and is moved into the task's own
   at once, so nothing is attributed to a later task.
5. `lib/browser/task/runTask.ts` runs Sky's chat engine with those tools,
   `wait_for_person`, and the host's own tools (`read_file`, `save_file`),
   under the rules in `task/prompt.ts`: look before acting, one move at a
   time, the person signs in, a download counts once the file was opened
   and checked.
6. The model's closing words become `report.md` in the task folder.

## Where things live

| Path | What |
| --- | --- |
| `~/.sky/browser/private-profile/` | The private worker's persistent browser profile, session-cookie checkpoint, and exclusive lease. Outside task files and the notebook; never deleted during task cleanup. |
| `~/.sky/browser/` | Sky's browser: `profile/` (every sign-in persists here), `driver.json` (the running driver's pid and port), `driver.log`, `downloads/` (the driver's landing place; each task moves its own out at once). Local to the Mac, like the Google profiles. |
| `~/.sky/browser/tasks/<date>_<HHMM>_<summary>/` | One folder per task |
| `…/files/` | Downloads and screenshots; the only place `save_file` moves from |
| `…/report.md` | What Sky did, saved, and could not do |
| `…/trace.jsonl` | Every step, plan and adviser reply as it happened |

## The Jev driver

The default. With the Experimental switch "Jev drives the browser" off, the
command hands the browser to the reasoning model instead. Jev's loop lives
in `lib/browser/jev/`. Code owns the loop and
TypeSafe's Jev picks each move, jev-ultrafast's shape drawn from the
accessibility snapshot instead of a page script:

1. `table.ts` turns a snapshot with bounding boxes into a numbered table of
   the controls in view: role, label, value, the text beside it, a
   dropdown's options. Private-worker snapshots include the actual viewport;
   an existing browser window must not inherit the driver's default dimensions,
   which can silently discard visible document controls. Frames come along; disabled and off-screen controls
   do not. A field that reads like a password or a code is marked secret.
2. `questions.ts` asks Jev everything in one request: which operation
   (click, type, select, scroll, wait, back, ask the person, done, blocked),
   which control for each operation that takes one, plus three yes/no
   judgments: does the page need the person, is the goal done, would the
   next move commit the person to something.
3. `decide.ts` checks the answers before anything runs: an option that was
   offered, probabilities that sum to one, a choice that is the most likely.
4. `runJevTask.ts` makes the move through the same browser server, looks
   again, and applies the gates in code: done at 0.85 (a download goal requires
   a saved file; a repeated completion claim without one ends as blocked), the person at 0.85 or when
   Jev says so, a risky move asked first at 0.5, blocked after three unchanged
   pages, sixty steps at most. The person is asked once per page: after they
   continue, the loop looks again, waits three seconds and looks once more
   if Jev still asks, and then runs Jev's next-best move on that page rather
   than ask the same thing again.
5. `typeText.ts`: Jev cannot write, so the reasoning model, at medium
   effort, writes a field's text
   from the task and the page, once per field. Secret fields are never typed.
6. `advisor.ts`: the same model reads at the moments Jev cannot: a page seen
   for the first time, a move that failed, a page that did not change, Jev
   wanting the person. It answers with a one-line plan that goes into Jev's
   state, a judgment on whether the page really needs the person, and, when
   it is sure, the move itself: a click, a direct visit to a link's own
   address, an Escape for an overlay, a scroll, a wait. Its judgment
   overrules Jev's "needs you" on a signed-in page.
7. `epilogue.ts`: the ending Jev cannot write. Each downloaded file gets a
   short conversation of its own: the model opens it with `read_file` and says in
   three lines what it is and whether it fits the task. A file larger than
   the model can read is reported as unchecked, never a failed run. Then one
   last conversation, without the files, moves the right ones with
   `save_file` where the task says and writes the report. A reading that
   fails, the model unreachable, counts for nothing: Jev's own judgment
   stands. Network trouble in the ending is waited out, three tries with
   longer pauses, and a model that stays unreachable gets one try per turn
   from then on; if it still cannot write, the facts are written by code.
   A check only reads; the finishing turn alone moves files, told what is
   in the task folder at that moment, so a report never contradicts what
   was saved.
8. `trace.jsonl` in the task folder records every page, step, plan and
   adviser reply as they happen, so a run killed midway can still be read.
   When the view goes blank after a move, a download popup that closed
   being the usual cause, the loop finds the task's tab again or reopens
   its last page before going on, and the adviser may send the task back
   to any address it has been to.
9. The server is started with `mcp/serverGuard.ts` preloaded: an error it
   throws outside any tool call, such as a download whose popup closed
   before the handler finished, is a line in `browser-server.log` rather
   than the end of the process. Should the server die anyway, the loop
   starts it once more on the same page, the profile still holding the
   session, and the move that died counts as a failed move.

Without files the closing report is written by code from the trace. Jev's
decisions cost about a thousand tokens and a fraction of a second each; an
adviser reading a few thousand tokens and a third of a second. Both ride
the same usage log as every other model call.

## Which browser

Sky's browser is Playwright's own Chromium when it is installed, the build
Playwright is tested against; otherwise the first installed
Chromium-family browser. Brave was the first choice until 2026-09-27, when
it crashed on its main thread right after downloads four times in a
morning, the same Brave bug the Google-console work met. The crash reports
sit in `~/Library/Logs/DiagnosticReports/`, and Sky's own trace of each
crash is the download-handler line in `driver.log`. The download
bookkeeping a crash leaves behind (`Default/Download Service`) is cleared
at every launch, since Brave crashes on it again.

## Looking like a normal browser

A site's bot wall reads the browser's own tells, and a person signing in
through an automated window is turned away with them. The launcher keeps
the browser ordinary rather than disguised: Playwright's automation
switches that leave a mark on the page are dropped, `AutomationControlled`
is disabled so `navigator.webdriver` reads false as it does for anyone,
and no viewport is forced, so the window, the screen and its scale agree.
Nothing is spoofed: a masked property is itself a tell, and the earlier
`navigator.webdriver` mask was one. What remains is Playwright's own
control channel, which the patched build patchright closes if a site still
objects.

## What the model may not do

The server offers more tools than the model sees. Code execution in the
page or the server, request bodies with their headers, and closing the
browser stay out (`BROWSER_TOOL_NAMES` in `mcp/tools.ts`). `save_file`
moves only files from the task folder. Passwords and saved codes are filled only by the private sign-in broker; other
authentication steps use `wait_for_person` for the person to complete in the browser.

## The batch helper beside it

`persistentContext.ts` is the older, batch-oriented helper: launch a
signed-in profile, run a callback, close. External batch commands that
sync from a site with no open API use it. LinkedIn import uses the private
worker above.

### Stored logins

`storedLogin.ts` signs such a profile back in when its session has lapsed,
with a login the person keeps for that one integration.
`lib/credentials/batchLogin.ts` finds it wherever they keep it, in this
order: the pick remembered for the purpose; the Login item in a connected
password manager whose saved website names the integration's origin; the
`login` entry under the integration's own category in Sky's keychain
(`sky secrets:set atlas main`), read through the same background
path as every API token Sky holds. A website names the origin when it is
the same host, or failing that a parent domain of it, with or without a
scheme: people save `atlas.example`, and the origin is fixed in the
integration's code, so the looser match only chooses among the person's
own items. Never-fill entries, excluded vaults, sibling subdomains and
lookalike suffixes stay out. A lone match is used and remembered; several
are the person's to pick once, in the terminal. A manager that is locked
or waiting for approval is reported, and the keychain entry stands in when
there is one.

Connecting the account under Settings → Browser automation, or saving the
keychain entry, is the grant, so a 07:00 automation can use the login
with no one at the machine. This is the owner's ruling of 2026-09-30 for
a batch integration's own origin; the private worker's run-scoped native
approval and saved autofill scope remain separate, for tasks a model
drives. The rest of the worker's boundary comes along. The site, its login
page and its controls are named in the integration's code, never by a
model. The values travel as sensitive values from the manager or the
keychain to Playwright element handles and nowhere else. The same network
guard keeps them on the login's origin and blocks any address that would
carry them, such as a GET form the page's script failed to take over. The
same redactor covers every line said about the attempt. A bot wall's
invisible check is waited for through the hidden token it fills; a check
that wants a person, a verification code, or a form other than the one
expected ends the attempt as `needs_person`, and the integration's own
command opens the window for the person. The session counts only once the
caller's own check says so, a token read rather than a submitted form.
Only a batch feature with a dedicated profile may use it: never Sky's
shared browser, never the private task worker.

## Verified

- 2026-10-02, the login lookup with fake providers and temp state: a lone
  matching item used and remembered; a website saved as the root domain
  taken, with a sibling subdomain, a lookalike, a suffix trick and a
  never-fill entry refused; exact-host items preferred over the root
  domain; a remembered pick read without a search; two matches offered to
  the person; no match falling back to the keychain; a locked manager
  falling back or reported; a manager that never answers given up on; a
  vanished pick forgotten and replaced.
- 2026-09-29, a stored login on a synthetic login page, an email and a
  password in a GET form the page's script submits behind an invisible bot
  check, headless: signed in once and proved the session by a token
  read; a check that never passes stopped before anything was sent, the
  login left in the fields for the person; a wrong password reported as
  refused after one try; a code step handed to the person; a GET form
  without its script blocked at the address, no request leaving with the
  login and no line of the log carrying it.
- 2026-09-27, Playwright's Chromium as Sky's browser: browserscan.net
  Normal, `navigator.webdriver` false, real pixel ratio; downloads and the
  self-closing-popup download land on the HTTP driver.
- 2026-09-27, an outage made on purpose, the model's connection failing
  the way the person's did: two failures then recovery during the ending —
  both files checked and saved, report right, 32 s; the model gone for good
  during the ending — both files reported unchecked and left in place, the
  report written by code, 22 s; the model gone for the whole task — Jev
  alone asked the person at the sign-in once, downloaded, done in 2.9 s.
- 2026-09-25, bot-detection pages, headed on a scratch profile: after the
  launch changes, browserscan.net reports Normal on Webdriver, User-Agent,
  CDP and Navigator, and bot.sannysoft.com passes its WebDriver checks.
  Before them, both flagged the masked `navigator.webdriver` and the
  device pixel ratio of a fixed viewport on a Retina screen.
- 2026-09-25, the Jev driver, real Jev and a language model typing, on three
  synthetic portals, headless: documents page — chose the 2025 form over
  2024 and a statement, done in 1.5 s over 2 decisions; behind a sign-in —
  asked the person once, then the same, 2.8 s; a search box — the typing
  model wrote "tax form 2025", Jev clicked Search, then the 2025 download.
  Decisions took 108 to 212 ms and about a thousand tokens each.
- 2026-09-25, sign-in handoff, model-driven on a synthetic portal behind a
  login form: the model asked the person instead of typing a password,
  looked again after Continue, downloaded the 2025 form, opened it, saved it.
  Seven tool calls, one ask.
- 2026-09-25, `sky browser:task` headed against a public page: the window
  opened on Sky's profile, the heading came back, `report.md` was written.
- 2026-09-25, model-driven on a synthetic portal with a 2024 and a 2025
  form: chose 2025, checked the file with `read_file`, moved it with
  `save_file`, reported the path. Five tool calls.
- 2026-09-25, scripted, no model: server starts from Sky's Playwright, the
  snapshot carries refs, a click produces a download in `files/`,
  `navigator.webdriver` reads undefined, screenshots arrive as image parts.

## Notes

- 2026-09-30: a batch profile's login comes from a connected password
  manager first, the keychain second.
- 2026-09-29: stored logins for batch profiles. The first integration's own
  story lives with its commands, outside this repo.
- 2026-09-25: the Jev driver behind the Experimental switch. See
  [2026-09-25-jev-picks-the-moves](2026-09-25-jev-picks-the-moves.md).
- 2026-09-25: first version — the command, the client, the runner. See
  [2026-09-25-sky-gets-a-general-purpose-browser](2026-09-25-sky-gets-a-general-purpose-browser.md).
