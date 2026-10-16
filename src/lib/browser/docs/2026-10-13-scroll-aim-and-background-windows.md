---
created: 2026-10-13
updated: 2026-10-13
---

# A scroll that moved nothing, and a task window that kept taking focus

A chat asked the browser task to open a report on an analytics dashboard
and say what its numbers meant. The run failed three ways at once, and the
fix for the third uncovered a fourth.

## What was wrong

1. **The scroll moved nothing.** Jev opened the report, dismissed a tip in
   its header, and scrolled toward the data table three times. The page
   never changed, so the loop stopped after three unchanged pages. The
   scroll was `page.mouse.wheel`, which lands wherever the pointer last
   was: on the header the dismiss click had just used. The report scrolls
   inside a panel of its own, and a wheel over the header has nothing to
   scroll. A headless reproduction: after a click on a header button, a
   wheel moved the panel 0 px; the same wheel over the panel moved it 500 px.
2. **Nothing came back to read.** Without downloads, a Jev task's report
   is written by code from its trace. Had the scroll worked, the chat would
   still have received a list of moves and no values from the page.
3. **Focus kept jumping.** The person was working on another macOS Space.
   Only LinkedIn imports used a background window; every other task called
   `page.bringToFront()` before each click and scroll. On macOS that
   activates Brave and switches Spaces, seven times in thirty seconds that run.

## What changed

- Every browser task opens in the background window LinkedIn imports
  already used. Input activates only the task tab. The window comes
  forward when the person is about to act in it, and a minimized one is
  restored first.
- `signIn/scroll.ts` scrolls from inside the page what a pointer in the
  middle of the window would scroll, else the largest uncovered panel in
  view. It never scrolls a page a dialog has locked, and it says how far
  the content moved and when it reached the end. Only a page that scrolls
  nothing by itself, or an embedded frame in the middle, still gets a wheel.
  The Jev loop counts a scroll that moved as a change.
- `jev/reading.ts`: a task that ends without files has the reasoning model
  read the page it ended on, and the report carries what that page shows.

## The trap in background windows

Playwright's click waits until its target holds still across two animation
frames. A page in a hidden window gets none. Measured with raw DevTools
calls on Playwright's Chromium: minimized, the page reads `hidden` and runs
no frames; with `Emulation.setFocusEmulationEnabled` on, it reads `visible`
and frames run; turned off again, hidden. Playwright sets focus emulation on
pages it opens, but its extension relay connects with `noDefaults: true`,
which skips it. So through the Brave extension a minimized task window made
every click time out. A throwaway extension confirmed `chrome.debugger`
accepts the command. With the official extension in a throwaway Brave
profile, the minimized task window's click landed in 93 ms once Sky turned
focus emulation on for its own task tab, and timed out after 5 s without it.

Rejected: forcing clicks, which skips the check that reports an overlay
covering the target; bringing the window forward before each input, which
was the original complaint.

## Not verified

- One live run on the same report saw every browser call take 15 to 30
  seconds, tripping the 30-second action deadline twice; each recovery
  opened a fresh connection, and the board then loaded blank. The next run,
  minutes later, read pages in 0.2 to 0.6 s and its report carried the
  table. The slow run's cause was not found: a settled throwaway Brave read
  pages in about 0.1 s with the task window shown, minimized with focus
  emulation, and minimized without it.
- A window on another Space. A minimized window was the hidden state
  measured. Focus emulation keeps the task page rendering however the
  window is hidden, but the Space case itself was not measured.
- The opt-in `existing/connection-e2e_test.ts` asserts that a handoff
  leaves the shown window focused. Run from a terminal on the Mac where
  this was fixed, that check failed the same way before the change, on
  untouched code. With that one check relaxed, the rest of the test passes,
  including the new click in a minimized window and its restore.
