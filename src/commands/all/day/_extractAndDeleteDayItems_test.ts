import * as path from 'node:path'
import { makeTempDir, readTextFile, writeTextFile } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import extractAndDeleteDayItems from './_extractAndDeleteDayItems.ts'

// Helper to create a test file with content
async function createTestFile(testDir: string, filename: string, content: string): Promise<string> {
  const filepath = path.join(testDir, filename)
  await writeTextFile(filepath, content)
  return filepath
}

test('extractAndDeleteDayItems - extracts and deletes items for matching date', async () => {
  const testDir = await makeTempDir({ prefix: 'extractAndDeleteDayItems_test_' })

  const markdown = `# Todos Personal

## 2025-01-15
- Task A
- Task B
- Task C

## 2025-01-20
- Task D
- Task E

## 2025-02-01
- Task F
`

  const filepath = await createTestFile(testDir, 'schedule.md', markdown)
  const { items } = await extractAndDeleteDayItems(filepath, '2025-01-20')

  assert({
    given: 'a markdown file with 2025-01-20 items',
    should: 'extract the items for that date',
    actual: items,
    expected: ['Task D', 'Task E'],
  })

  // Verify the file was modified correctly
  const modifiedContent = await readTextFile(filepath)

  assert({
    given: 'a markdown file after extraction',
    should: 'have 2025-01-20 section removed',
    actual: modifiedContent.includes('## 2025-01-20'),
    expected: false,
  })

  assert({
    given: 'a markdown file after extraction',
    should: 'still have 2025-01-15 section',
    actual: modifiedContent.includes('## 2025-01-15'),
    expected: true,
  })

  assert({
    given: 'a markdown file after extraction',
    should: 'still have 2025-02-01 section',
    actual: modifiedContent.includes('## 2025-02-01'),
    expected: true,
  })
})

test('extractAndDeleteDayItems - returns empty array when date not found', async () => {
  const testDir = await makeTempDir({ prefix: 'extractAndDeleteDayItems_test_' })

  const markdown = `# Todos Personal

## 2025-01-15
- Task A

## 2025-02-01
- Task B
`

  const filepath = await createTestFile(testDir, 'no_date.md', markdown)
  const { items } = await extractAndDeleteDayItems(filepath, '2025-01-20')

  assert({
    given: 'a markdown file without the requested date',
    should: 'return empty array',
    actual: items,
    expected: [],
  })

  // Verify file wasn't modified
  const content = await readTextFile(filepath)
  assert({
    given: 'a markdown file without the requested date',
    should: 'not modify the file',
    actual: content,
    expected: markdown,
  })
})

test('extractAndDeleteDayItems - handles date with no list items', async () => {
  const testDir = await makeTempDir({ prefix: 'extractAndDeleteDayItems_test_' })

  const markdown = `# Todos Personal

## 2025-01-15
- Task A

## 2025-01-20

## 2025-02-01
- Task B
`

  const filepath = await createTestFile(testDir, 'empty_date.md', markdown)
  const { items } = await extractAndDeleteDayItems(filepath, '2025-01-20')

  assert({
    given: 'a date heading with no list',
    should: 'return empty array',
    actual: items,
    expected: [],
  })
})

test('extractAndDeleteDayItems - handles date followed by non-list content', async () => {
  const testDir = await makeTempDir({ prefix: 'extractAndDeleteDayItems_test_' })

  const markdown = `# Todos Personal

## 2025-01-15
- Task A

## 2025-01-20

This is a paragraph, not a list.

## 2025-02-01
- Task B
`

  const filepath = await createTestFile(testDir, 'date_paragraph.md', markdown)
  const { items } = await extractAndDeleteDayItems(filepath, '2025-01-20')

  assert({
    given: 'a date heading followed by a paragraph',
    should: 'return empty array',
    actual: items,
    expected: [],
  })
})

test('extractAndDeleteDayItems - finds last occurrence when multiple exist', async () => {
  const testDir = await makeTempDir({ prefix: 'extractAndDeleteDayItems_test_' })

  const markdown = `# Todos Personal

## 2025-01-20
- First occurrence Task

## 2025-02-01
- Other Task

## 2025-01-20
- Second occurrence Task A
- Second occurrence Task B
`

  const filepath = await createTestFile(testDir, 'duplicate_date.md', markdown)
  const { items } = await extractAndDeleteDayItems(filepath, '2025-01-20')

  assert({
    given: 'multiple occurrences of the same date',
    should: 'extract items from the last occurrence',
    actual: items,
    expected: ['Second occurrence Task A', 'Second occurrence Task B'],
  })

  // Verify only the last occurrence was removed
  const modifiedContent = await readTextFile(filepath)

  assert({
    given: 'multiple occurrences after extraction',
    should: 'still have the first occurrence',
    actual: modifiedContent.includes('First occurrence Task'),
    expected: true,
  })

  assert({
    given: 'multiple occurrences after extraction',
    should: 'not have the second occurrence items',
    actual: modifiedContent.includes('Second occurrence Task'),
    expected: false,
  })
})

test('extractAndDeleteDayItems - handles complex list items with time prefixes', async () => {
  const testDir = await makeTempDir({ prefix: 'extractAndDeleteDayItems_test_' })

  const markdown = `# Todos Personal

## 2025-01-15

- Simple task
- 09:00 > Morning meeting
- 14:30 > Task with **bold** text
- 18:00 > Re-listen to [podcast](https://example.com) - episode 553
- Multi-line task that
  continues here
- Task with \`code\`

## 2025-01-20
- Other task
`

  const filepath = await createTestFile(testDir, 'complex_items.md', markdown)
  const { items } = await extractAndDeleteDayItems(filepath, '2025-01-15')

  assert({
    given: 'complex list items with formatting and time prefixes',
    should: 'extract all items with their text content',
    actual: items.length,
    expected: 6,
  })

  assert({
    given: 'list item with time prefix',
    should: 'preserve the time prefix',
    actual: items[1],
    expected: '09:00 > Morning meeting',
  })

  assert({
    given: 'list item with time and markdown formatting',
    should: 'preserve both',
    actual: items[2],
    expected: '14:30 > Task with **bold** text',
  })

  assert({
    given: 'list item with time and link',
    should: 'preserve the complete format',
    actual: items[3],
    expected: '18:00 > Re-listen to [podcast](https://example.com) - episode 553',
  })
})

test('extractAndDeleteDayItems - properly handles spacing after deletion', async () => {
  const testDir = await makeTempDir({ prefix: 'extractAndDeleteDayItems_test_' })

  const markdown = `# Todos Personal

## 2025-01-15
- Task A

## 2025-01-20
- Task B
- Task C

## 2025-02-01
- Task D
`

  const filepath = await createTestFile(testDir, 'spacing_test.md', markdown)
  await extractAndDeleteDayItems(filepath, '2025-01-20')

  const modifiedContent = await readTextFile(filepath)

  // Check that the structure is still valid markdown
  assert({
    given: 'markdown after deletion',
    should: 'maintain proper structure',
    actual: /## 2025-01-15\n- Task A\n\n## 2025-02-01/.test(modifiedContent),
    expected: true,
  })
})

test('extractAndDeleteDayItems - warns about past dates', async () => {
  const testDir = await makeTempDir({ prefix: 'extractAndDeleteDayItems_test_' })

  const markdown = `# Todos Personal

## 2023-01-15
- Old task that should have been done

## 2025-01-20
- Current task

## 2026-01-01
- Future task
`

  const filepath = await createTestFile(testDir, 'past_dates.md', markdown)
  // This test mainly verifies the function handles past dates correctly
  // The warnings are printed to console as expected
  const { items } = await extractAndDeleteDayItems(filepath, '2025-01-20')

  assert({
    given: 'a file with past and future dates',
    should: 'extract the requested date items',
    actual: items,
    expected: ['Current task'],
  })
})

test('extractAndDeleteDayItems - handles real-world schedule format', async () => {
  const testDir = await makeTempDir({ prefix: 'extractAndDeleteDayItems_test_' })

  // Mimicking the actual format from schedule-personal.md
  const markdown = `# Todos Personal

## 2025-10-21
- 18:00 > Re-listen to Alex Hormozi podcast on speed and "all great things take work" - 553

## 2025-11-19
- 18:00 > Re-listen to Alex Hormozi podcast on speed and "fuck end of the week" - 542

## 2025-12-01
- Morning routine check-in
- 15:00 > Review quarterly goals
`

  const filepath = await createTestFile(testDir, 'real_schedule.md', markdown)
  const { items } = await extractAndDeleteDayItems(filepath, '2025-11-19')

  assert({
    given: 'real-world schedule format',
    should: 'extract the scheduled item',
    actual: items,
    expected: ['18:00 > Re-listen to Alex Hormozi podcast on speed and "fuck end of the week" - 542'],
  })

  const modifiedContent = await readTextFile(filepath)

  assert({
    given: 'file after extraction',
    should: 'still have other dates',
    actual: modifiedContent.includes('2025-10-21') && modifiedContent.includes('2025-12-01'),
    expected: true,
  })

  assert({
    given: 'file after extraction',
    should: 'not have the extracted date',
    actual: modifiedContent.includes('2025-11-19'),
    expected: false,
  })
})

test('extractAndDeleteDayItems - extracts reference links used by items', async () => {
  const testDir = await makeTempDir({ prefix: 'extractAndDeleteDayItems_test_' })

  const markdown = `---
---

# Professional Todos

## 2025-02-09
- Check on Milo Response [milo-response-check][]

[milo-response-check]: https://example.com/slack/thread
`

  const filepath = await createTestFile(testDir, 'schedule_with_links.md', markdown)
  const { items, links } = await extractAndDeleteDayItems(filepath, '2025-02-09')

  assert({
    given: 'a schedule with reference links',
    should: 'extract the items',
    actual: items,
    expected: ['Check on Milo Response [milo-response-check][]'],
  })

  assert({
    given: 'a schedule with reference links',
    should: 'extract the link definitions',
    actual: links.has('milo-response-check'),
    expected: true,
  })

  assert({
    given: 'a schedule with reference links',
    should: 'have the correct URL',
    actual: links.get('milo-response-check')?.href,
    expected: 'https://example.com/slack/thread',
  })

  const modifiedContent = await readTextFile(filepath)
  assert({
    given: 'schedule file after extraction',
    should: 'remove the link definition from the file',
    actual: modifiedContent.includes('[milo-response-check]'),
    expected: false,
  })
})
