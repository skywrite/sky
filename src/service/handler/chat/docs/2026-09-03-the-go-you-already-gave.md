---
created: 2026-09-03
updated: 2026-09-03
---

# The go you already gave

Asking before a tool acts is the rule. Asking again for something already
allowed is a tax, and on the web every `google_agent` call paid it: the
terminal had learned to remember a go (pasted file, created file, "always"),
the web session had not, and a mission that only created a new document
asked anyway, everywhere.

## What changed

- **Create-only missions run without a go.** `google:agent` declares
  `needsApprovalFor`: a mission with no target file and no import touches
  nothing of the person's, so it runs; a mission aimed at an existing file,
  or one importing a local file to Drive, still asks. The static is a new
  hook next to `approvalSessionKey`, honoured by `toolApprovalPolicy` on
  every host — with or without blessings.
- **The web keeps the terminal's ledger.** `createChatHost` holds one
  `SessionBlessings` per thread. A pasted Google file reference blesses the
  file for the process (`onMessage`, before the turn). A file a tool reports
  as created is blessed for good. The approval card carries `sessionKey`
  when a go can stand for the session; the page offers "Allow for this
  file", the answer route passes `always` through, and the handler blesses
  the key. Durable keys are saved with the thread (`approvals`); seeding
  them back into a thread restored after a restart rides with the
  restart work.
- **The policy is one function.** `toolApprovalPolicy(tool, options)`
  decides for a gated tool: exempt call → approved; blessed key → approved;
  else ask. `createToolApprovalConfig` applies it per discovered tool.

## Rules

- A paste is permission for now, not a standing grant: mentions never
  persist.
- A tool exempts its own calls; the host never decides that for it.
- The card offers "Allow for this file" only when the tool gave the call a
  key. A create mission has none — and needs none.

## Verified

- `commands/lib/chat/notebookTools_test.ts` — exempt calls run on a host
  with no blessings; targeted calls ask unless blessed; a tool declaring
  nothing keeps the static gate.
- `commands/all/google/agent/lib/approval_test.ts` — create-only missions
  need no go; targeted and import missions do; the key is the file id.
- `chatRoute_test.ts` — the answer route passes `always` to the decision
  only when the card carried a key.
