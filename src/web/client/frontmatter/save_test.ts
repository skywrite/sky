import { spyOn } from 'bun:test'
import { assert, test } from '#test'
import { swapChip } from './model.ts'
import { saveFrontmatter } from './save.ts'

const FILE = 'time/2026/W32/08-05/meeting_atlas-sync.md'
const DOC = '---\nwho: Jane, Sam Park\nmedium: meeting\n---\n\n# Atlas sync\n'

/**
 * The service holding one file: reads answer its text and version, writes check the version.
 * `others` writes land just before the panel's, as another window's save would.
 */
function holding(content: string, others: Array<(text: string) => string> = []) {
  const file = { content, version: 1 }
  const asked: string[] = []
  const fetch = spyOn(globalThis, 'fetch').mockImplementation((async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    asked.push(`${init?.method ?? 'GET'} ${String(input)}`)
    if (init?.method !== 'PUT') return Response.json(file)
    const other = others.shift()
    if (other) {
      file.content = other(file.content)
      file.version++
    }
    const write = JSON.parse(String(init.body)) as { content: string; version: number }
    if (write.version !== file.version) return Response.json({ message: 'File changed' }, { status: 409 })
    file.content = write.content
    file.version++
    return Response.json({ version: file.version })
  }) as typeof globalThis.fetch)
  return { file, asked, restore: () => fetch.mockRestore() }
}

const meant = (text: string) => swapChip(text, 'who', 'Jane', 'Jane Doe')

test({ name: 'save front matter - a change made while reading is written to the file under its version' }, async () => {
  const service = holding(DOC)
  try {
    const shown = await saveFrontmatter(FILE, meant)
    assert({
      given: 'a first name swapped for the person it meant, with no editor holding the file',
      should: 'read the file, write the change under the version it read, and answer the block now on disk',
      actual: [shown, service.file.content, service.asked],
      expected: [
        'who: Jane Doe, Sam Park\nmedium: meeting',
        DOC.replace('who: Jane,', 'who: Jane Doe,'),
        [`GET /docs/_api/content/${FILE}`, `PUT /docs/_api/content/${FILE}`],
      ],
    })
  } finally {
    service.restore()
  }
})

test({ name: 'save front matter - a write landing in between is read again, once' }, async () => {
  const elsewhere = (text: string) => text.replace('medium: meeting', 'medium: call')
  const once = holding(DOC, [elsewhere])
  let kept = ''
  try {
    await saveFrontmatter(FILE, meant)
    kept = once.file.content
  } finally {
    once.restore()
  }
  const twice = holding(DOC, [elsewhere, elsewhere])
  let refused: unknown
  try {
    await saveFrontmatter(FILE, meant).catch((error: unknown) => {
      refused = error
    })
  } finally {
    twice.restore()
  }
  assert({
    given: 'another save landing just before the write, then before the second try as well',
    should: 'apply the change to what the other save wrote and keep both; then give up and say so',
    actual: [kept, refused instanceof Error ? refused.message : refused],
    expected: [
      DOC.replace('who: Jane,', 'who: Jane Doe,').replace('medium: meeting', 'medium: call'),
      'The file changed while it was being saved. Try again.',
    ],
  })
})

test({ name: 'save front matter - a service out of reach is said plainly' }, async () => {
  const fetch = spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
  let refused: unknown
  try {
    await saveFrontmatter(FILE, meant).catch((error: unknown) => {
      refused = error
    })
  } finally {
    fetch.mockRestore()
  }
  assert({
    given: 'no service to read the file from',
    should: 'say Sky could not be reached',
    actual: refused instanceof Error ? refused.message : refused,
    expected: 'Sky could not be reached. Try again.',
  })
})
