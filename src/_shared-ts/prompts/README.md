---
created: 2026-01-12
updated: 2026-09-05
---

# Prompt System

The [prompt library design](docs/README.md) covers Settings → Prompts, notebook
customizations, shared templates, previews, and the runtime loader.

A templating system for AI prompts using Handlebars and Markdown.

## File Format

Prompt files use the `.prompt.md` extension and consist of YAML frontmatter followed by a Handlebars-templated Markdown body.

```markdown
---
schema: 0.2.0
created: 2026-01-12
updated: 2026-01-12
description: Daily journal reflection questions
---

# Journal Questions for {{context.notebookDate}}

Today is {{context.notebookDate}} (notebook time).
System time is {{context.systemDate}}.

{{#if user.input}}
Processing: {{user.input}}
{{/if}}
```

## Schema Version

The `schema` field in frontmatter indicates which schema version the prompt uses (semver). This enables:

- **Forward compatibility**: Older systems can reject prompts they don't understand
- **Migration paths**: When variable names change, version can guide updates
- **Documentation**: Each version documents its supported variables

**Current version: 0.2.0**

## Variable Syntax

Variables use `{{namespace.fieldName}}` with camelCase field names:

```handlebars
{{context.notebookDate}}
{{user.input}}
{{decision.description}}
```

## Namespaces

### Reserved Namespaces

These namespaces have defined fields and generate warnings for unknown fields:

| Namespace | Source | Example |
|-----------|--------|---------|
| `global` | Notebook-wide constants | `global.userName`, `global.userCompany` |
| `prompt` | File frontmatter (auto-populated) | `prompt.name`, `prompt.description` |
| `context` | Runtime state (auto-populated) | `context.notebookDate`, `context.systemTimezone` |
| `user` | Caller-provided user input | `user.input`, `user.query` |

### Entity Namespaces

Any other namespace is treated as an entity namespace (e.g., `decision.*`, `meeting.*`). These are caller-provided and open-ended—no warnings for unknown fields.

```handlebars
{{decision.description}}
{{decision.timeframe}}
{{meeting.title}}
{{meeting.attendees}}
```

## Supported Variables

### Context Variables (auto-populated)

| Variable | Type | Description |
|----------|------|-------------|
| `context.notebookDate` | string | Current notebook date (YYYY-MM-DD) |
| `context.systemDate` | string | System/wall-clock date (YYYY-MM-DD) |
| `context.notebookTimezone` | string | Notebook timezone (e.g., `America/New_York`) |
| `context.systemTimezone` | string | System timezone (e.g., `America/New_York`) |

### Prompt Metadata (auto-populated from frontmatter)

| Variable | Type | Description |
|----------|------|-------------|
| `prompt.name` | string | File slug (e.g., `journal-questions`) |
| `prompt.description` | string | Description from frontmatter |
| `prompt.created` | string | Creation date (YYYY-MM-DD) |
| `prompt.updated` | string | Last updated date (YYYY-MM-DD) |

### User Input (caller-provided)

| Variable | Type | Description |
|----------|------|-------------|
| `user.input` | string | User-supplied input to be processed by the template |

Additional `user.*` fields can be provided by the caller.

### Global Constants

| Variable | Type | Description |
|----------|------|-------------|
| `global.userName` | string | User's display name |
| `global.userCompany` | string | User's company name |

## Usage

```typescript
import {
  parsePromptFile,
  renderPromptFile,
  renderParsedPrompt,
  type RenderInput,
} from '#/shared/prompts/mod.ts'

// Build render input
const input: RenderInput = {
  context: {
    notebookDate: '2026-01-12',
    systemDate: '2026-01-12',
    notebookTimezone: 'America/New_York',
    systemTimezone: 'America/New_York',
  },
  user: {
    input: 'User-supplied content to embed in the template',
  },
  // Entity namespaces for domain-specific data
  decision: {
    description: 'Whether to hire Sarah',
    timeframe: 'End of week',
  },
}

// Option 1: Parse and render in one step
const { output, warnings } = renderPromptFile(fileContent, 'journal-questions.prompt.md', input)

// Option 2: Parse first, render later
const parsed = parsePromptFile(fileContent, 'journal-questions.prompt.md')
const { output, warnings } = renderParsedPrompt(parsed, input)

// Check warnings
if (warnings.length > 0) {
  console.warn('Render warnings:', warnings)
}
```

## Warning System

The render functions return warnings for potential issues:

| Warning Type | Description |
|--------------|-------------|
| `bare_variable` | Variable without namespace (e.g., `{{FOO}}`) |
| `unknown_namespace` | Namespace not provided in input (e.g., `{{foo.bar}}`) |
| `unknown_field` | Unknown field in reserved namespace (e.g., `{{context.unknown}}`) |

Entity namespaces (non-reserved) do not generate `unknown_field` warnings since they're caller-defined.

## Handlebars Features

The system uses [Handlebars](https://handlebarsjs.com/) for templating:

- **Variables**: `{{namespace.fieldName}}`
- **Conditionals**: `{{#if namespace.field}}...{{else}}...{{/if}}`
- **Unless**: `{{#unless namespace.field}}...{{/unless}}`
- **Each (for arrays)**: `{{#each namespace.list}}{{this}}{{/each}}`

## VSCode Integration

The VSCode extension provides autocomplete for variables inside `{{}}` in `.prompt.md` files. Variable definitions are sourced from `variables.ts`.

## Changelog

| Version | Date | Description |
|---------|------|-------------|
| 0.2.0 | 2026-01-26 | **Breaking**: Namespaced variables (`context.notebookDate`, `user.input`), warning system, entity namespaces |
| 0.1.1 | 2026-01-13 | Added `USER_INPUT` variable for embedding user-supplied content in templates |
| 0.1.0 | 2026-01-12 | [Initial implementation](../../../../docs/AI/problems-solved/2026/01-12-prompt-system.md) |

## Migration from 0.1.x to 0.2.0

| Old (0.1.x) | New (0.2.0) |
|-------------|-------------|
| `USER_INPUT` | `user.input` |
| `DATE_NOTEBOOK_TODAY` | `context.notebookDate` |
| `DATE_SYSTEM_TODAY` | `context.systemDate` |
| `TIMEZONE_NOTEBOOK_TODAY` | `context.notebookTimezone` |
| `TIMEZONE_SYSTEM_TODAY` | `context.systemTimezone` |
| `PROMPT_NAME` | `prompt.name` |
| `PROMPT_DESCRIPTION` | `prompt.description` |
| `PROMPT_CREATED` | `prompt.created` |
| `PROMPT_UPDATED` | `prompt.updated` |

Custom fields (e.g., `DECISION_DESCRIPTION`) become entity namespaces (e.g., `decision.description`).
