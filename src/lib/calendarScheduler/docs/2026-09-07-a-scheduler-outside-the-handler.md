---
created: 2026-09-07
updated: 2026-09-07
---

# A scheduler outside the handler

Scheduling began in the New meeting composer. Its HTTP folder came to own parsing,
contact matching, validation, calendar reads and persistent jobs; its Google/Zoom
adapter lived under a command group without an actual scheduling command. A new
command would either import web internals or rebuild their decisions.

`CalendarScheduler` now owns the application workflow in `lib/calendarScheduler`.
Calendar naming distinguishes invitations from notebook meeting documents. The
web boundary supplies contacts, interaction scores and its reload hold; the
provider and browser operations live under shared libraries. The command talks
to the service so a browser save can outlive the command process.

The natural-language command prepares a durable draft before sending. A second
interpretation of "tomorrow at three" could resolve a different day or contact;
send therefore takes only the prepared ID and reads immutable resolved fields.
The same ID owns its creation receipt. Retrying after a lost response does not
repeat the interpretation or create another invitation.

Moving persistence must preserve old receipts. The existing state directory and
receipt format stay in use. The new `/calendar/_api` path and existing composer
path share one route instance: separate job managers would each see the other's
running job as an interrupted owner. Conflict rechecks, uncertain-save handling
and the browser's verified readback remain part of the shared workflow.

Tests use synthetic contacts and stubbed Calendar writes. They verify the prepare
and send operations through the command, immutable fields after restart,
concurrent retries, failed availability checks and unconfirmed saves. Chat and
voice registration remain separate work.
