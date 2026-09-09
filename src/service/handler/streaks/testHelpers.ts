import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { dayFile } from '#shared/nbfs/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { createStreaksRoutes } from './mod.ts'
import { StreaksStore } from './store.ts'

export const STREAKS_TODAY = '2026-05-20'
export const readInput = {
  title: 'Read a chapter',
  rule: 'Read one chapter of a book.',
  why: 'Make room for ideas.',
  schedule: 'daily',
  start: '2026-05-18',
}

export async function streaksFixture() {
  const temporary = await mkdtemp(path.join(tmpdir(), 'sky-streaks-test-'))
  const root = path.join(temporary, 'notebook')
  await mkdir(root)
  const store = new StreaksStore(
    {
      root,
      timeDir: path.join(root, 'time'),
      streaksDir: path.join(root, 'streaks'),
      stateDir: path.join(temporary, 'streaks-state'),
      dayStateDir: path.join(temporary, 'day-state'),
    },
    async () => new PlainDate(STREAKS_TODAY),
  )
  const app = createStreaksRoutes({ store })
  const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
    app.request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
  const file = (date: string) => path.join(root, 'time', dayFile(date))
  return {
    root,
    temporary,
    store,
    app,
    post,
    file,
    async day(date: string, items: string[] = [], ended = false) {
      const text = `---\ndate: ${date}\nstarted: 08:00\n${ended ? 'ended: 21:00\n' : ''}---\n\n# ${date}\n\n## Streaks\n\n${items.map((item) => `- ${item}`).join('\n') || '-'}\n\n## Personal Complete\n\n- Keep this [reference][book] unchanged.\n\n[book]: https://example.com/book\n`
      await mkdir(path.dirname(file(date)), { recursive: true })
      await writeFile(file(date), text)
      return text
    },
    readDay: (date: string) => readFile(file(date), 'utf8'),
    dispose: () => rm(temporary, { recursive: true, force: true }),
  }
}
