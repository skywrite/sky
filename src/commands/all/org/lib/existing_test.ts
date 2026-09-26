import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import { existingOrganization } from './existing.ts'

test('existingOrganization finds a name already taken, as a name or an alternate one, whatever the punctuation', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sky-org-names-'))
  try {
    await mkdir(path.join(dir, 'tech', 'software'), { recursive: true })
    await writeFile(
      path.join(dir, 'tech', 'software', 'Atlas.md'),
      '---\nname: Atlas, Inc.\nalt: Atlas Labs; AL\n---\n',
    )
    const found = async (name: string) => {
      const file = await existingOrganization(dir, name)
      return file && path.relative(dir, file)
    }
    assert({
      given: 'an organization named "Atlas, Inc." with the alternate names Atlas Labs and AL',
      should: 'treat its name without punctuation, each alternate name in any case, as taken, and a new name as free',
      actual: [await found('Atlas Inc'), await found('atlas labs'), await found('AL'), await found('Cedar')],
      expected: ['tech/software/Atlas.md', 'tech/software/Atlas.md', 'tech/software/Atlas.md', undefined],
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
