---
created: 2026-09-22
updated: 2026-09-22
---

# Sky does the console

Connecting a personal Gmail to Sky meant a walkthrough no one outside
software would finish: a Google Cloud project, six APIs, a consent screen,
a publish, a client, and two long strings pasted into a form. Since
mid-2025 Google shows the client secret only once, in the dialog that
makes it, which made the paste step worse. And the walkthrough's own API
list was short by two — anyone following it would have hit a 403 on the
first Gmail call.

Today Sky drives the console itself. The person clicks Connect, reads what
they are agreeing to, and a window opens for them to sign in. Sky makes the
project, switches the APIs on, names the app, publishes it, makes the
client and reads its pair straight into the keychain, then opens Google's
permission page in the same window. They tick the boxes; Sky is connected.
The page shows it as a checklist ticking off, with the two moments the
window needs them said plainly.

Two choices worth keeping:

- **Sky agrees to Google's two terms boxes for the person**, who agrees once
  on Sky's start screen with both documents linked. The alternative was
  two pauses in the run waiting for a click in the window.
- **A step Sky cannot do becomes the person's**, not a failure. The console
  moves its buttons; when one is gone the checklist shows the written step,
  the person does it, presses Continue, and Sky looks again. The run also
  resumes after a closed window or a crash.

Under the surface, an account now remembers which client pair issued its
grant. Sky's own pairs live as `google/client:<projectId>` beside the shared
`google/client`, so a personal account with its own project sits next to a
work account on a workspace-internal client.

Not yet proven: the selectors against the real console. The first live run
on a personal account is the proof, and the fallback is what makes a wrong
selector a pause. Also for later: a shared, Google-verified client would make
Connect a ten-second thing — it needs Google's restricted-scope verification.
