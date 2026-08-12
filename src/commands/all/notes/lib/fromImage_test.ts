import { assert, test } from '#test'
import { demoteBodyHeadings, stripCodeFence } from './fromImage.ts'

test('stripCodeFence', async (t) => {
  await t.step('unwraps a body the model fenced as markdown', () => {
    assert({
      given: 'a whole answer wrapped in a ```markdown fence',
      should: 'return the markdown inside it',
      actual: stripCodeFence('```markdown\n## Agenda\n\n- Ship Atlas\n```'),
      expected: '## Agenda\n\n- Ship Atlas',
    })
  })

  await t.step('unwraps an unlabelled fence', () => {
    assert({
      given: 'a whole answer wrapped in a bare fence',
      should: 'return the markdown inside it',
      actual: stripCodeFence('```\n## Agenda\n```'),
      expected: '## Agenda',
    })
  })

  await t.step('leaves a body that merely contains a fence alone', () => {
    const body = '## Setup\n\n```bash\nbun install\n```\n\n## Next'
    assert({
      given: 'a code block in the middle of the note',
      should: 'return the body unchanged',
      actual: stripCodeFence(body),
      expected: body,
    })
  })

  await t.step('leaves an unfenced body alone', () => {
    assert({
      given: 'plain markdown',
      should: 'return it trimmed',
      actual: stripCodeFence('\n## Agenda\n\n- Ship Atlas\n'),
      expected: '## Agenda\n\n- Ship Atlas',
    })
  })
})

test('demoteBodyHeadings', async (t) => {
  await t.step('leaves a body that already starts at h2 alone', () => {
    const body = '## Agenda\n\n- Ship Atlas\n\n### Risks\n\n- Timeline'
    assert({
      given: 'no h1 anywhere in the body',
      should: 'return the body unchanged',
      actual: demoteBodyHeadings(body),
      expected: body,
    })
  })

  await t.step('shifts the whole tree down when the model emits an h1', () => {
    assert({
      given: 'a body opening at h1 with an h2 beneath it',
      should: 'demote both so the file keeps a single title',
      actual: demoteBodyHeadings('# Atlas launch\n\n## Risks\n\n- Timeline'),
      expected: '## Atlas launch\n\n### Risks\n\n- Timeline',
    })
  })

  await t.step('keeps h6 where it is', () => {
    assert({
      given: 'an h6 in a body that also has an h1',
      should: 'demote the h1 and leave the h6 alone',
      actual: demoteBodyHeadings('# Atlas launch\n\n###### Footnote'),
      expected: '## Atlas launch\n\n###### Footnote',
    })
  })

  await t.step('leaves a comment inside a fenced block alone', () => {
    assert({
      given: 'a shell comment in a code block alongside a real h1',
      should: 'demote only the heading',
      actual: demoteBodyHeadings('# Setup\n\n```bash\n# install first\nbun install\n```'),
      expected: '## Setup\n\n```bash\n# install first\nbun install\n```',
    })
  })

  await t.step('does not treat a fenced comment as an h1 on its own', () => {
    const body = '## Setup\n\n```bash\n# install first\n```'
    assert({
      given: 'a shell comment in a code block and no real h1',
      should: 'return the body unchanged',
      actual: demoteBodyHeadings(body),
      expected: body,
    })
  })

  await t.step('handles a tilde fence', () => {
    assert({
      given: 'a ~~~ block containing a hash line, plus a real h1',
      should: 'demote only the heading',
      actual: demoteBodyHeadings('# Setup\n\n~~~\n# not a heading\n~~~'),
      expected: '## Setup\n\n~~~\n# not a heading\n~~~',
    })
  })

  await t.step('ignores a hash that is not a heading', () => {
    assert({
      given: 'a line starting with # but no space, alongside a real h1',
      should: 'demote the heading and leave the hashtag alone',
      actual: demoteBodyHeadings('# Atlas launch\n\n#atlas'),
      expected: '## Atlas launch\n\n#atlas',
    })
  })
})
