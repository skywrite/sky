import { assert, test } from '#test'
import { slackToMarkdown } from './renderSlack.ts'

test('slackToMarkdown: bold', () => {
  assert({
    given: 'Slack bold *text*',
    should: 'convert to Markdown bold',
    actual: slackToMarkdown('Hello *world*!'),
    expected: 'Hello **world**!',
  })
})

test('slackToMarkdown: bold multi-word', () => {
  assert({
    given: 'Slack bold with spaces inside',
    should: 'convert to Markdown bold',
    actual: slackToMarkdown('*hello world*'),
    expected: '**hello world**',
  })
})

test('slackToMarkdown: strikethrough', () => {
  assert({
    given: 'Slack strikethrough ~text~',
    should: 'convert to Markdown strikethrough',
    actual: slackToMarkdown('This is ~deleted~ text'),
    expected: 'This is ~~deleted~~ text',
  })
})

test('slackToMarkdown: link with label', () => {
  assert({
    given: 'Slack link <url|label>',
    should: 'convert to Markdown link',
    actual: slackToMarkdown('Visit <https://example.com|Example>'),
    expected: 'Visit [Example](https://example.com)',
  })
})

test('slackToMarkdown: bare link', () => {
  assert({
    given: 'Slack bare link <url>',
    should: 'unwrap to plain URL',
    actual: slackToMarkdown('See <https://example.com>'),
    expected: 'See https://example.com',
  })
})

test('slackToMarkdown: user mention', () => {
  assert({
    given: 'Slack user mention <@U123ABC>',
    should: 'convert to @user',
    actual: slackToMarkdown('Hey <@U123ABC>, look'),
    expected: 'Hey @user, look',
  })
})

test('slackToMarkdown: channel mention', () => {
  assert({
    given: 'Slack channel mention <#C123|general>',
    should: 'convert to #name',
    actual: slackToMarkdown('Post in <#C123ABC|general>'),
    expected: 'Post in #general',
  })
})

test('slackToMarkdown: special mentions', () => {
  assert({
    given: '<!here> mention',
    should: 'convert to @here',
    actual: slackToMarkdown('<!here> heads up'),
    expected: '@here heads up',
  })
})

test('slackToMarkdown: HTML entities', () => {
  assert({
    given: 'HTML entities &amp; &lt; &gt;',
    should: 'decode them',
    actual: slackToMarkdown('A &amp; B &lt; C &gt; D'),
    expected: 'A & B < C > D',
  })
})

test('slackToMarkdown: code span preserved', () => {
  assert({
    given: 'code span with *bold-like* content',
    should: 'not convert bold inside code',
    actual: slackToMarkdown('Run `*not bold*` here'),
    expected: 'Run `*not bold*` here',
  })
})

test('slackToMarkdown: code block preserved', () => {
  assert({
    given: 'code block with *bold-like* content',
    should: 'not convert bold inside code block',
    actual: slackToMarkdown('```\n*not bold*\n```'),
    expected: '```\n*not bold*\n```',
  })
})

test('slackToMarkdown: decorative line', () => {
  assert({
    given: 'decorative *===* line',
    should: 'convert to horizontal rule',
    actual: slackToMarkdown('*======*'),
    expected: '---',
  })
})

test('slackToMarkdown: italic preserved', () => {
  assert({
    given: 'Slack italic _text_',
    should: 'pass through as Markdown italic',
    actual: slackToMarkdown('This is _italic_ text'),
    expected: 'This is _italic_ text',
  })
})
