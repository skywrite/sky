---
created: 2026-09-10
updated: 2026-09-10
---

# Chat recovery cannot block HTTP

A model can emit invalid tool JSON with a very long run of whitespace.
The SDK's parse error includes that input. Recovery retains both provider
history and the host's inspectable tool record, so the same whitespace can
appear in several fields. YAML multiline scalars add indentation to those
blank lines, making the stored metadata substantially larger.

The shared frontmatter splitter used `.replace(/^\s+|\s+$/g, '')` to trim
the header. Its trailing alternative retries from every interior whitespace
character when non-whitespace follows the run. A synthetic error such as
`"Invalid JSON: " + "\n  ".repeat(20_000) + "Expected closing brace"`
therefore produces quadratic work. The delimiter search and YAML parser
were not the expensive steps. `String.trim()` preserves the contents with
linear work.

Recovery started in an async function while HTTP was starting. That did not
isolate its synchronous parser: a single file could occupy the same event
loop used for requests, heartbeats, and restart timers. The service remained
alive and listening, so launchd had no reason to recover it. Repeated source
reloads made each new process revisit the same file.

Three boundaries now prevent the recurrence:

- The shared splitter trims with `String.trim()`.
- Snapshot continuation data uses the existing `CONTEXT-LOG` JSON `session`
  field, also used by filed chats. JSON escapes newlines without multiplying
  them through YAML indentation. Values remain exact; errors and provider
  history are not truncated. The reader still accepts older YAML snapshots.
- The web host parses snapshots and saved chats in a worker, passing the
  caller's speaker label so transcript roles stay identical. A ten-second
  deadline terminates a slow worker. Snapshot failures are logged, the file
  stays intact, and restoration proceeds to the next file. HTTP can answer
  throughout. A timer racing a parser on the HTTP thread would not provide
  this protection.

Regression checks cover long interior whitespace, both storage formats,
exact continuation data, and a CPU-bound worker that cannot block its
caller's timers or outlive its deadline. Existing route tests exercise
multiple restarts, filing preferences, branching, and provider history.
