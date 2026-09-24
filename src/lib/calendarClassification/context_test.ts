import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import { readCalendarOwnerContext } from './context.ts'

test('calendar context reads household facts from legacy and freeform profiles, and works without setup', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sky-calendar-owner-'))
  const file = path.join(dir, 'journal', 'about-me.md')
  try {
    const empty = await readCalendarOwnerContext(dir)
    await mkdir(path.dirname(file))
    await writeFile(
      file,
      '# About Me - Jane Doe\n\n## Family\n\nPartner: Jordan. Children: Alex and Sam.\n\n## Professional\n\nCompany: Atlas.\n',
    )
    const legacy = await readCalendarOwnerContext(dir)
    await writeFile(
      file,
      '---\nname: Jane Doe\n---\n\nBuilds software at Atlas.\n\nMy children are Alex and Sam.\n\nLikes hiking.\n',
    )
    const freeform = await readCalendarOwnerContext(dir)
    assert({
      given: 'no profile, a section-based profile, and the settings editor’s freeform biography',
      should: 'include identity and family facts without unrelated biography or requiring setup',
      actual: [empty, legacy, freeform],
      expected: [
        { name: '', family: '' },
        { name: 'Jane Doe', family: 'Partner: Jordan. Children: Alex and Sam.' },
        { name: 'Jane Doe', family: 'My children are Alex and Sam.' },
      ],
    })
    await writeFile(
      file,
      `---\nname: Jane Doe\n---\n\n## Family\n\n${'Background '.repeat(500)}\n\nChildren: Alex and Sam.\n`,
    )
    assert({
      given: 'a family section containing an oversized paragraph followed by a complete relationship',
      should: 'keep complete facts within the context budget',
      actual: await readCalendarOwnerContext(dir),
      expected: { name: 'Jane Doe', family: 'Children: Alex and Sam.' },
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
