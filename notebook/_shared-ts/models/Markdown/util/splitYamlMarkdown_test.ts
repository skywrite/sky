import { assert, test } from '#test'
import splitYamlMarkdown from './splitYamlMarkdown.ts'

// from: https://raw.githubusercontent.com/jxson/front-matter/master/examples/complex-yaml.md

const FIXTURE = `
---

title: This is a title!

name: Derek Worthen
age: young
contact:
email: email@domain.com
address: some location
pets:
- cat
- dog
- bat
match: !!js/regexp /pattern/gim



---

# Markdown

- item
- item
- item
`

const FIXTURE_EXPECTED_YAML = `title: This is a title!

name: Derek Worthen
age: young
contact:
email: email@domain.com
address: some location
pets:
- cat
- dog
- bat
match: !!js/regexp /pattern/gim`

const FIXTURE_EXPECTED_MARKDOWN = `
# Markdown

- item
- item
- item
`

test(splitYamlMarkdown.name, () => {
  assert({
    given: 'valid markdown file with yaml',
    should: 'extract yaml string',
    actual: splitYamlMarkdown(FIXTURE),
    expected: { yaml: FIXTURE_EXPECTED_YAML, markdown: FIXTURE_EXPECTED_MARKDOWN },
  })
})

test(splitYamlMarkdown.name, () => {
  const FIXTURE_YAML_BLOCK = ['name: bob', 'who: jon']

  const FIXTURE_YAML = ['---', ...FIXTURE_YAML_BLOCK, '---'].join('\n')

  const FIXTURE_MARKDOWN = ['', '# Some Title', '', '## Some Subheading'].join('\n')

  assert({
    given: 'simple yaml block',
    should: 'still extract empty yaml block',
    actual: splitYamlMarkdown(FIXTURE_YAML + FIXTURE_MARKDOWN),
    expected: { yaml: FIXTURE_YAML_BLOCK.join('\n'), markdown: FIXTURE_MARKDOWN.trimStart() },
  })
})

test(splitYamlMarkdown.name, () => {
  const FIXTURE_YAML = ['---', '---'].join('\n')

  const FIXTURE_MARKDOWN = ['', '# Some Title', '', '## Some Subheading'].join('\n')

  assert({
    given: 'empty yaml block',
    should: 'still extract empty yaml block',
    actual: splitYamlMarkdown(FIXTURE_YAML + FIXTURE_MARKDOWN),
    expected: { yaml: '', markdown: FIXTURE_MARKDOWN.trimStart() },
  })
})

test(splitYamlMarkdown.name, () => {
  const FIXTURE_YAML = ['---', '', '---'].join('\n')

  const FIXTURE_MARKDOWN = ['', '# Some Title', '', '## Some Subheading'].join('\n')

  assert({
    given: 'empty yaml block',
    should: 'still extract empty yaml block',
    actual: splitYamlMarkdown(FIXTURE_YAML + FIXTURE_MARKDOWN),
    expected: { yaml: '', markdown: FIXTURE_MARKDOWN.trimStart() },
  })
})
