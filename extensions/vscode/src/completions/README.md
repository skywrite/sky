---
created: 2026-01-18
updated: 2026-01-18
---

# Completion Providers

This directory contains VSCode completion item providers for the Notebook extension.

## Icon Conventions

All completion providers should use consistent icons based on entity type.

**Visual reference:** https://microsoft.github.io/vscode-codicons/dist/codicon.html

| Entity Type | CompletionItemKind | Icon Description |
|-------------|-------------------|------------------|
| Decisions | `Event` | Calendar/clock icon |
| People | `User` | Person silhouette |
| Organizations | `Struct` | Three-bar structure icon |
| Tags | `Text` | Generic text (abc) |
| Files | `File` | Document icon |
| Folders | `Folder` | Folder icon |
| Timezones | `Value` | Value icon |
| Recurring patterns | `Constant` | Constant icon |

## Providers

| Provider | Trigger Context | Entities |
|----------|----------------|----------|
| `PeopleCompletionItemProvider` | YAML frontmatter (`who`, `to`, `from`, etc.) | People |
| `OrganizationsCompletionItemProvider` | YAML frontmatter (`org`, `orgs`, `rel`) | Organizations |
| `TagsCompletionItemProvider` | YAML frontmatter | Tags |
| `DayItemCompletionProvider` | Day item lines (`- HH:MM >`) | People, Organizations, Tags |
| `DayCompletionProvider` | Day/date references | Days (files/folders) |
| `DecisionsCompletionItemProvider` | `decisions/` path prefix | Decisions |
| `AttachmentsCompletionItemProvider` | Attachment paths | Files |
| `CurrentDirCompletionItemProvider` | Current directory | Files |
| `TimezoneCompletionItemProvider` | Timezone fields | Timezones |
| `RecurringPatternCompletionProvider` | Recurring pattern fields | Patterns |
