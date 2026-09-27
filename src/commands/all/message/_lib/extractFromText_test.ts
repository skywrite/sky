import { readPromptFile } from '#shared/prompts/load.ts'
import { renderPromptFile } from '#shared/prompts/mod.ts'
import { assert, test } from '#test'

test('extract-from-text.prompt.md', async (t) => {
  const content = await readPromptFile(new URL('../prompts/extract-from-text.prompt.md', import.meta.url).pathname)
  // An explicit me namespace stops the render from reading the real AboutMe profile.
  const render = (me: Record<string, string>) =>
    renderPromptFile(content, 'extract-from-text.prompt.md', { me, user: { now: '2026-01-27 09:30' } })

  await t.step('names the owner from the profile', () => {
    const { output, warnings } = render({ fullName: 'Jane Doe' })
    assert({
      given: 'a profile with a name',
      should: 'file "You" and "Me" lines under that name, with no "Me" left',
      actual: {
        warnings,
        owner: output.includes('belongs to Jane Doe.'),
        me: output.includes('belongs to "Me"'),
        unfilled: output.includes('{{'),
      },
      expected: { warnings: [], owner: true, me: false, unfilled: false },
    })
  })

  await t.step('falls back to "Me" without a name', () => {
    const { output, warnings } = render({})
    assert({
      given: 'no name in the profile',
      should: 'keep the "Me" wording and no stray name',
      actual: {
        warnings,
        me: output.includes('belongs to "Me", unless the owner'),
        name: output.includes('Jane Doe'),
        unfilled: output.includes('{{'),
      },
      expected: { warnings: [], me: true, name: false, unfilled: false },
    })
  })
})
