---
created: 2026-09-11
updated: 2026-09-11
---

# Research context limits

Research starts a fresh mission with the balanced model. ChatSession supplies
its standing system instructions and current reading budget through ToolHooks;
both chat hosts pass that trusted envelope through the command boundary using
AsyncLocalStorage. Retrieved documents and conversation history stay with the
parent. Task-specific scope and user corrections belong in the question or
purpose. A zero budget disables research before any notebook or model access.
Standalone research defaults to a 300k reading budget.

The parent budget is fitted to the research model's declared context window
using the shared reading-budget policy. The model reserves 16k output tokens.
Before every SDK request, a research-only model middleware measures the whole
serialized prompt and tool definitions against the fitted input budget, and
accumulated tool evidence against the reading budget. This
uses the shared token estimate and model-window headroom, not a provider token
counter. If needed, older tool results become labeled excerpts. Instructions,
the mission, and tool call/result pairs are preserved. If those cannot fit,
the request fails locally instead of sending an oversized prompt.

ContextAssembler is a relevance selector with a **soft** budget: it keeps one
eligible document even if that document alone exceeds the budget. Research
must therefore bound the actual serialized tool output after selection. The
query result's pages carry source paths and offsets into the original files;
`notebook_read` can continue at `nextOffset` or jump to literal text with `find`.
Counts and truncation flags describe partial coverage. Only emitted documents
enter the run's source list. Changing the assembler's global admission rule
would affect other callers and would not bound accumulated tool history.
