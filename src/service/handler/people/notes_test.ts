import { assert, test } from '#test'
import { renderProfileNotes } from './notes.ts'

test('Profile notes omit empty template categories and redundant heading labels', () => {
  const html = renderProfileNotes(
    '# Jane Doe\n\n## Overview\n\nOverview\n\nA design partner.\n\n## Background\n\n## Family\n\n### Children\n\n## Info\n\nKeep this note.\n\n## Empty\n\n- \n',
  )
  assert({
    given: 'a profile with an old Overview echo and empty nested categories',
    should: 'show only populated sections and one Overview',
    actual: html,
    expected: '<h2>Overview</h2>\n<p>A design partner.</p>\n<h2>Info</h2>\n<p>Keep this note.</p>',
  })
  assert({
    given: 'a populated child section, a Markdown code example, and a duplicate heading',
    should: 'retain hierarchy and literal code while displaying the heading once',
    actual: renderProfileNotes(
      '## Overview\n\n## Overview\n\nA studio.\n\n## Background\n\n### Work\n\nResearch.\n\n```md\n## Empty\n```\n',
    ),
    expected:
      '<h2>Overview</h2>\n<p>A studio.</p>\n<h2>Background</h2>\n<h3>Work</h3>\n<p>Research.</p>\n<pre><code class="language-md">## Empty\n</code></pre>',
  })
  assert({
    given: 'a template containing only empty sections and comments',
    should: 'render no empty category headings',
    actual: renderProfileNotes('# Jane Doe\n\n## Overview\n\n<!-- TODO -->\n\n## Background\n\n## Info\n'),
    expected: '',
  })
})
