import { assert, test } from '#test'
import { slackToMarkdown } from './slackMarkdown.ts'

test({ name: 'slack markdown - inline styles and links become markdown' }, () => {
  assert({
    given: "Slack's bold, italic, strike, and a labelled link",
    should: 'become markdown bold, italic, strike, and a link',
    actual: slackToMarkdown('*Bold* and _italic_ and ~gone~, see <https://example.com/doc|the doc>.'),
    expected: '**Bold** and *italic* and ~~gone~~, see [the doc](https://example.com/doc).',
  })
})

test({ name: 'slack markdown - code passes through untouched' }, () => {
  assert({
    given: 'an inline code span and a fence holding Slack-looking marks',
    should: 'leave both exactly as written',
    actual: slackToMarkdown('`*not bold*` then\n```\n_raw_ *raw*\n```'),
    expected: '`*not bold*` then  \n```\n_raw_ *raw*\n```',
  })
})

test({ name: 'slack markdown - lines break where Slack breaks them; a quote ends where it ends' }, () => {
  assert({
    given: 'a heading over a line, a quote followed by prose, and a dot bullet',
    should: 'hard-break between lines, blank-line after the quote, and turn the dot into a dash',
    actual: slackToMarkdown('*Title*\nfirst line\n\n> quoted\nafter\n• item'),
    expected: '**Title**  \nfirst line\n\n> quoted\n\nafter  \n- item',
  })
})

test({ name: 'slack markdown - asterisks inside words and existing double marks are left alone' }, () => {
  assert({
    given: 'a product name with an inner asterisk and text already in markdown strike',
    should: 'change neither',
    actual: slackToMarkdown('rate*star and ~~done~~ and snake_case_name'),
    expected: 'rate*star and ~~done~~ and snake_case_name',
  })
})
