---
created: 2026-09-25
updated: 2026-09-25
---

# Sky gets a general-purpose browser

Until today every browser thing Sky did was a script for one site: the
LinkedIn import knew which heading to wait for and how many times to
scroll; the Google console setup knew every button by name. A script
breaks when the site changes, and it cannot do a task nobody wrote a
script for.

The ask was different: "log in to my brokerage, download my tax forms,
then upload them to the tax portal." A general browser, driven by Sky.

## What was built

A task is an ordinary chat-engine turn with browser tools. The tools come
from Playwright's own MCP server, which ships inside the Playwright Sky
already pins, so there is no second browser stack to keep in step. The
model looks at the page as text, a snapshot with a short id on every
control, decides one move, makes it, and looks again. When the site wants
the person, Sky stops and says so at the terminal.

Three small pieces made it fit Sky:

- The server runs from Sky's profile under `~/.sky`, with the same
  launch flags the batch helper proved on a bot-walled login.
- Screenshots reach the model as images through the same result shape
  `read_file` uses for PDFs.
- `save_file` moves a checked download where the task asks and never
  overwrites.

## What it is not yet

No web page. No task that outlives the terminal. One task at a time on one
profile. The LinkedIn import still runs its own script; it can move onto
this once a document task has run for real.
