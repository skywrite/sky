---
created: 2026-09-07
updated: 2026-09-07
---

# Terminal questions must open prompts

The first command adapter printed `CalendarPreparation.questions` and returned.
That was sufficient for an AI caller to continue a conversation, but a person
running the CLI saw a list of contacts and a question followed by the shell prompt.
There was no way to answer the question in that invocation.

A top-level interactive terminal now uses the shared `Prompter` seam. Missing
details open a text prompt; organizers, contacts and addresses use selectors;
missing email addresses use validated text input. A complete invitation is shown
before the final create-and-send confirmation. JSON, pipes, composed commands and
service calls keep the structured preparation contract without terminal prompts.

Contact and address choices must survive review exactly. Encoding them back into
the original request for another model call could lose the selection or reinterpret
relative timing. `CalendarScheduler.review` accepts explicit resolved fields,
revalidates them, checks current availability and persists a draft. The terminal
uses that draft's ID for sending and for recovery after a lost response.

Tests use synthetic contacts and mocked Calendar writes. They cover the complete
prompt sequence, cancellation, missing details, manual addresses, a calendar check
that changes during selection and all noninteractive call modes. A real Clack
terminal session verifies the pickers and final confirmation with no external send.
