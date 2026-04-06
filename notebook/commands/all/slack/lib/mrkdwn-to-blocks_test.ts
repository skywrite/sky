import { assert, test } from '#test'
import { mrkdwnToRichTextBlocks, parseInlineElements } from './mrkdwn-to-blocks.ts'

// --- parseInlineElements ---

test('parseInlineElements: plain text', () => {
  assert({
    given: 'plain text with no formatting',
    should: 'return single text element',
    actual: parseInlineElements('Hello world'),
    expected: [{ type: 'text', text: 'Hello world' }],
  })
})

test('parseInlineElements: bold', () => {
  assert({
    given: '*bold* text',
    should: 'parse bold with style',
    actual: parseInlineElements('Hello *world*!'),
    expected: [
      { type: 'text', text: 'Hello ' },
      { type: 'text', text: 'world', style: { bold: true } },
      { type: 'text', text: '!' },
    ],
  })
})

test('parseInlineElements: italic', () => {
  assert({
    given: '_italic_ text',
    should: 'parse italic with style',
    actual: parseInlineElements('This is _important_'),
    expected: [
      { type: 'text', text: 'This is ' },
      { type: 'text', text: 'important', style: { italic: true } },
    ],
  })
})

test('parseInlineElements: code', () => {
  assert({
    given: '`code` text',
    should: 'parse code with style',
    actual: parseInlineElements('Run `npm install`'),
    expected: [
      { type: 'text', text: 'Run ' },
      { type: 'text', text: 'npm install', style: { code: true } },
    ],
  })
})

test('parseInlineElements: link with label', () => {
  assert({
    given: '<url|label> link',
    should: 'parse as link element',
    actual: parseInlineElements('Visit <https://example.com|Example>'),
    expected: [
      { type: 'text', text: 'Visit ' },
      { type: 'link', url: 'https://example.com', text: 'Example' },
    ],
  })
})

test('parseInlineElements: bare link', () => {
  assert({
    given: '<url> link',
    should: 'parse as link element without label',
    actual: parseInlineElements('See <https://example.com>'),
    expected: [
      { type: 'text', text: 'See ' },
      { type: 'link', url: 'https://example.com' },
    ],
  })
})

// --- mrkdwnToRichTextBlocks ---

test('mrkdwnToRichTextBlocks: plain text returns no blocks', () => {
  const result = mrkdwnToRichTextBlocks('Hello world')
  assert({
    given: 'plain text with no lists',
    should: 'return hasLists false and empty blocks',
    actual: result.hasLists,
    expected: false,
  })
})

test('mrkdwnToRichTextBlocks: bullet list with - prefix', () => {
  const result = mrkdwnToRichTextBlocks('- Item 1\n- Item 2\n- Item 3')
  assert({
    given: 'lines starting with -',
    should: 'return hasLists true',
    actual: result.hasLists,
    expected: true,
  })
  assert({
    given: 'three bullet items',
    should: 'create one rich_text_list with 3 items',
    actual: result.blocks[0].elements.filter((e) => e.type === 'rich_text_list').length,
    expected: 1,
  })
})

test('mrkdwnToRichTextBlocks: bullet list with bullet character', () => {
  const result = mrkdwnToRichTextBlocks('• Item 1\n• Item 2')
  assert({
    given: 'lines starting with •',
    should: 'detect as bullet list',
    actual: result.hasLists,
    expected: true,
  })
})

test('mrkdwnToRichTextBlocks: sub-bullets with indentation', () => {
  const result = mrkdwnToRichTextBlocks('- Main 1\n- Main 2\n  - Sub 2a\n  - Sub 2b\n- Main 3')
  const lists = result.blocks[0].elements.filter((e) => e.type === 'rich_text_list')
  assert({
    given: 'bullets with indented sub-bullets',
    should: 'create 3 list groups (main, sub, main)',
    actual: lists.length,
    expected: 3,
  })
  assert({
    given: 'the sub-bullet group',
    should: 'have indent: 1',
    actual: (lists[1] as { indent?: number }).indent,
    expected: 1,
  })
})

test('mrkdwnToRichTextBlocks: white bullet ◦ sub-bullets', () => {
  const result = mrkdwnToRichTextBlocks('• Top level\n  ◦ Sub-bullet\n  ◦ Another sub')
  assert({
    given: '• top-level and ◦ sub-bullets',
    should: 'detect as lists',
    actual: result.hasLists,
    expected: true,
  })
  const lists = result.blocks[0].elements.filter((e) => e.type === 'rich_text_list')
  assert({
    given: '• and indented ◦ bullets',
    should: 'create 2 list groups (top and sub)',
    actual: lists.length,
    expected: 2,
  })
  assert({
    given: 'the ◦ sub-bullet group',
    should: 'have indent: 1',
    actual: (lists[1] as { indent?: number }).indent,
    expected: 1,
  })
})

test('mrkdwnToRichTextBlocks: mixed text and bullets', () => {
  const result = mrkdwnToRichTextBlocks('Here is a list:\n- Item 1\n- Item 2')
  assert({
    given: 'text followed by bullets',
    should: 'detect lists',
    actual: result.hasLists,
    expected: true,
  })
  assert({
    given: 'text before the list',
    should: 'have a rich_text_section first',
    actual: result.blocks[0].elements[0].type,
    expected: 'rich_text_section',
  })
  assert({
    given: 'the list after text',
    should: 'have a rich_text_list second',
    actual: result.blocks[0].elements[1].type,
    expected: 'rich_text_list',
  })
})

test('mrkdwnToRichTextBlocks: numbered list', () => {
  const result = mrkdwnToRichTextBlocks('1. First\n2. Second\n3. Third')
  assert({
    given: 'numbered list items',
    should: 'detect as list',
    actual: result.hasLists,
    expected: true,
  })
  const list = result.blocks[0].elements.find((e) => e.type === 'rich_text_list')
  assert({
    given: 'numbered list',
    should: 'have style ordered',
    actual: (list as { style: string }).style,
    expected: 'ordered',
  })
})

test('mrkdwnToRichTextBlocks: bold text in list items is parsed', () => {
  const result = mrkdwnToRichTextBlocks('- *Bold item*\n- Normal item')
  const list = result.blocks[0].elements.find((e) => e.type === 'rich_text_list') as {
    elements: { elements: unknown[] }[]
  }
  assert({
    given: 'a bold list item',
    should: 'parse inline bold in the list item elements',
    actual: list.elements[0].elements,
    expected: [{ type: 'text', text: 'Bold item', style: { bold: true } }],
  })
})
