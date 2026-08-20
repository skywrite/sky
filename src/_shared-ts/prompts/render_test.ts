import { assert, test } from '#test'
import { renderPromptFile, renderTemplate } from './render.ts'
import type { RenderInput } from './types.ts'

// =============================================================================
// Basic Variable Substitution (0.2.0 namespaced syntax)
// =============================================================================

test('renderTemplate - namespaced variable substitution', () => {
  const given = 'a template with namespaced variables'
  const should = 'substitute values correctly'

  const template = 'Today is {{context.notebookDate}} in {{context.notebookTimezone}}.'
  const input: RenderInput = {
    context: {
      notebookDate: '2026-01-12',
      notebookTimezone: 'America/New_York',
    },
  }
  const { output, warnings } = renderTemplate(template, input)

  assert({ actual: output, expected: 'Today is 2026-01-12 in America/New_York.', given, should })
  assert({ actual: warnings.length, expected: 0, given, should: 'have no warnings' })
})

test('renderTemplate - notebookDay derives from notebookDate', () => {
  const given = 'a template using context.notebookDay'
  const should = 'render the weekday of the supplied notebook date'

  const template = '{{context.notebookDate}} is a {{context.notebookDay}}.'
  const input: RenderInput = {
    context: { notebookDate: '2026-08-20' },
  }
  const { output, warnings } = renderTemplate(template, input)

  assert({ actual: output, expected: '2026-08-20 is a Thursday.', given, should })
  assert({ actual: warnings.length, expected: 0, given, should: 'have no warnings' })
})

test('renderTemplate - notebookDay ignores a caller-supplied value', () => {
  const given = 'a caller passing a notebookDay that contradicts notebookDate'
  const should = 'derive the weekday from notebookDate so the pair cannot disagree'

  const template = '{{context.notebookDay}}'
  const input: RenderInput = {
    context: { notebookDate: '2026-08-20', notebookDay: 'Funday' },
  }
  const { output } = renderTemplate(template, input)

  assert({ actual: output, expected: 'Thursday', given, should })
})

test('renderTemplate - user namespace substitution', () => {
  const given = 'a template with user.input'
  const should = 'substitute user values correctly'

  const template = 'Input: {{user.input}}'
  const input: RenderInput = {
    user: { input: 'Hello World' },
  }
  const { output, warnings } = renderTemplate(template, input)

  assert({ actual: output, expected: 'Input: Hello World', given, should })
  assert({ actual: warnings.length, expected: 0, given, should: 'have no warnings' })
})

test('renderTemplate - entity namespace substitution', () => {
  const given = 'a template with entity namespace (decision.*)'
  const should = 'substitute entity values correctly'

  const template = 'Decision: {{decision.title}} - {{decision.description}}'
  const input: RenderInput = {
    decision: {
      title: 'Hire VP Engineering',
      description: 'Whether to hire Sarah for the role',
    },
  }
  const { output, warnings } = renderTemplate(template, input)

  assert({
    actual: output,
    expected: 'Decision: Hire VP Engineering - Whether to hire Sarah for the role',
    given,
    should,
  })
  assert({ actual: warnings.length, expected: 0, given, should: 'have no warnings for entity namespaces' })
})

// =============================================================================
// Conditional Rendering
// =============================================================================

test('renderTemplate - conditional with if', () => {
  const given = 'a template with conditional'
  const should = 'render truthy branch'

  const template = '{{#if context.notebookDate}}Has date: {{context.notebookDate}}{{/if}}'
  const input: RenderInput = {
    context: { notebookDate: '2026-01-12' },
  }
  const { output } = renderTemplate(template, input)

  assert({ actual: output, expected: 'Has date: 2026-01-12', given, should })
})

test('renderTemplate - conditional with unless', () => {
  const given = 'a template with unless and missing value'
  const should = 'render the unless branch'

  const template = '{{#unless user.input}}No input provided{{/unless}}'
  const input: RenderInput = {
    user: {},
  }
  const { output } = renderTemplate(template, input)

  assert({ actual: output, expected: 'No input provided', given, should })
})

// =============================================================================
// Warning System
// =============================================================================

test('renderTemplate - warns on bare variables', () => {
  const given = 'a template with bare variable (no namespace)'
  const should = 'generate bare_variable warning'

  const template = 'Hello {{FOO_BAR}}'
  const { output, warnings } = renderTemplate(template)

  assert({ actual: output, expected: 'Hello ', given, should: 'render empty for unknown bare variable' })
  assert({ actual: warnings.length, expected: 1, given, should: 'have one warning' })
  assert({ actual: warnings[0].type, expected: 'bare_variable', given, should })
  assert({ actual: warnings[0].variable, expected: 'FOO_BAR', given, should: 'include variable name' })
})

test('renderTemplate - warns on unknown namespace', () => {
  const given = 'a template with unknown namespace'
  const should = 'generate unknown_namespace warning'

  const template = 'Hello {{foo.bar}}'
  const { output, warnings } = renderTemplate(template)

  assert({ actual: output, expected: 'Hello ', given, should: 'render empty for unknown namespace' })
  assert({ actual: warnings.length, expected: 1, given, should: 'have one warning' })
  assert({ actual: warnings[0].type, expected: 'unknown_namespace', given, should })
  assert({ actual: warnings[0].namespace, expected: 'foo', given, should: 'include namespace' })
  assert({ actual: warnings[0].field, expected: 'bar', given, should: 'include field' })
})

test('renderTemplate - warns on unknown field in reserved namespace', () => {
  const given = 'a template with unknown field in context namespace'
  const should = 'generate unknown_field warning'

  const template = 'Value: {{context.unknownField}}'
  const { output, warnings } = renderTemplate(template)

  assert({ actual: output, expected: 'Value: ', given, should: 'render empty for unknown field' })
  assert({ actual: warnings.length, expected: 1, given, should: 'have one warning' })
  assert({ actual: warnings[0].type, expected: 'unknown_field', given, should })
  assert({ actual: warnings[0].namespace, expected: 'context', given, should: 'include namespace' })
  assert({ actual: warnings[0].field, expected: 'unknownField', given, should: 'include field' })
})

test('renderTemplate - no warning for entity namespace unknown fields', () => {
  const given = 'a template with entity namespace (meeting.*)'
  const should = 'not generate warning for unknown fields in entity namespaces'

  const template = 'Meeting: {{meeting.title}}'
  const input: RenderInput = {
    meeting: { title: 'Standup' },
  }
  const { output, warnings } = renderTemplate(template, input)

  assert({ actual: output, expected: 'Meeting: Standup', given, should: 'render correctly' })
  assert({ actual: warnings.length, expected: 0, given, should: 'have no warnings' })
})

// =============================================================================
// Full File Rendering
// =============================================================================

test('renderPromptFile - full integration with 0.2.0 syntax', () => {
  const given = 'a complete .prompt.md file with 0.2.0 syntax'
  const should = 'parse and render correctly'

  const content = `---
schema: 0.2.0
created: 2026-01-01
updated: 2026-01-12
description: Daily journal questions
---

# {{prompt.name}} - {{prompt.description}}

Created: {{prompt.created}}
Today (notebook): {{context.notebookDate}}
Today (system): {{context.systemDate}}`

  const input: RenderInput = {
    context: {
      notebookDate: '2026-01-12',
      systemDate: '2026-01-13',
    },
  }

  const { output, warnings } = renderPromptFile(content, 'journal-questions.prompt.md', input)

  assert({
    actual: output.includes('# journal-questions - Daily journal questions'),
    expected: true,
    given,
    should: 'include prompt metadata',
  })

  assert({
    actual: output.includes('Created: 2026-01-01'),
    expected: true,
    given,
    should: 'include created date from frontmatter',
  })

  assert({
    actual: output.includes('Today (notebook): 2026-01-12'),
    expected: true,
    given,
    should: 'include notebook date from context',
  })

  assert({
    actual: output.includes('Today (system): 2026-01-13'),
    expected: true,
    given,
    should: 'include system date from context',
  })

  assert({
    actual: warnings.length,
    expected: 0,
    given,
    should: 'have no warnings for valid template',
  })
})

test('renderPromptFile - preserves markdown formatting', () => {
  const given = 'a prompt with markdown'
  const should = 'preserve markdown syntax'

  const content = `---
schema: 0.2.0
created: 2026-01-12
updated: 2026-01-12
description: Test
---

## Heading

- List item 1
- List item 2

**Bold** and *italic* on {{context.notebookDate}}`

  const input: RenderInput = {
    context: { notebookDate: '2026-01-12' },
  }

  const { output } = renderPromptFile(content, 'test.prompt.md', input)

  assert({
    actual: output.includes('## Heading'),
    expected: true,
    given,
    should: 'preserve headings',
  })

  assert({
    actual: output.includes('- List item 1'),
    expected: true,
    given,
    should: 'preserve lists',
  })

  assert({
    actual: output.includes('**Bold** and *italic* on 2026-01-12'),
    expected: true,
    given,
    should: 'preserve inline formatting and substitute variables',
  })
})

test('renderTemplate - user.input substitution', () => {
  const given = 'a template with user.input'
  const should = 'substitute user input correctly'

  const template = `Clean up this transcript:

{{user.input}}

Fix grammatical errors.`

  const input: RenderInput = {
    user: { input: 'um so like I was thinking about the project' },
  }

  const { output } = renderTemplate(template, input)
  const expected = `Clean up this transcript:

um so like I was thinking about the project

Fix grammatical errors.`

  assert({ actual: output, expected, given, should })
})

test('renderTemplate - user.input optional', () => {
  const given = 'a template without user.input in context'
  const should = 'render empty string for missing user.input'

  const template = 'Input: {{user.input}}'
  const { output } = renderTemplate(template)

  assert({ actual: output, expected: 'Input: ', given, should })
})

// =============================================================================
// Override Behavior
// =============================================================================

test('renderTemplate - context override', () => {
  const given = 'explicit context values'
  const should = 'override system defaults'

  const template = '{{context.notebookDate}} - {{context.systemDate}}'
  const input: RenderInput = {
    context: {
      notebookDate: '2025-12-31',
      systemDate: '2026-01-01',
    },
  }

  const { output } = renderTemplate(template, input)

  assert({ actual: output, expected: '2025-12-31 - 2026-01-01', given, should })
})

test('renderPromptFile - prompt metadata auto-populated', () => {
  const given = 'a prompt file'
  const should = 'auto-populate prompt namespace from frontmatter'

  const content = `---
schema: 0.2.0
created: 2026-01-15
updated: 2026-01-20
description: Auto-populate test
---

Name: {{prompt.name}}
Desc: {{prompt.description}}
Created: {{prompt.created}}
Updated: {{prompt.updated}}`

  const { output, warnings } = renderPromptFile(content, 'auto-test.prompt.md')

  assert({
    actual: output.includes('Name: auto-test'),
    expected: true,
    given,
    should: 'include prompt name from filename',
  })

  assert({
    actual: output.includes('Desc: Auto-populate test'),
    expected: true,
    given,
    should: 'include description from frontmatter',
  })

  assert({
    actual: output.includes('Created: 2026-01-15'),
    expected: true,
    given,
    should: 'include created date from frontmatter',
  })

  assert({
    actual: output.includes('Updated: 2026-01-20'),
    expected: true,
    given,
    should: 'include updated date from frontmatter',
  })

  assert({
    actual: warnings.length,
    expected: 0,
    given,
    should: 'have no warnings',
  })
})
