import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { workstreamStoragePaths } from '#lib/workstreams/storagePaths.ts'
import Document from '#shared/models/Markdown/Document/mod.ts'
import { assert, test } from '#test'
import { loadOwnerInitiatives } from './ownerInitiatives.ts'

test('Only current declared initiatives provide owner context, with migrated workstreams taking precedence', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-outbox-initiatives-test-'))
  const config = { DIR_BASE: root, DIR_STATE: path.join(root, 'state'), DIR_PROJECTS: path.join(root, 'projects') }
  const write = async (file: string, yaml: Record<string, unknown>, body = '') => {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, new Document(yaml, body).toMarkdown())
  }
  try {
    assert({
      given: 'an empty notebook',
      should: 'allow checking without initiatives',
      actual: await loadOwnerInitiatives(config),
      expected: [],
    })
    await write(
      path.join(config.DIR_PROJECTS, 'open', 'Atlas', '_project', 'overview.md'),
      { name: 'Atlas', status: 'open' },
      'Alex chooses the pilot scope.',
    )
    await write(path.join(config.DIR_PROJECTS, 'open', 'Closed', '_project', 'overview.md'), {
      name: 'Closed',
      status: 'closed',
    })
    const legacy = path.join(root, 'workstreams')
    const current = workstreamStoragePaths(config).dir
    await write(path.join(legacy, 'Pilot', 'workstream.md'), {
      id: 'Pilot',
      title: 'Old pilot',
      state: 'active',
      intent: 'Old scope.',
    })
    await write(path.join(current, 'Pilot', 'workstream.md'), {
      id: 'Pilot',
      title: 'Pilot',
      state: 'active',
      intent: 'Approve the pilot.',
      outcome: 'A chosen scope.',
    })
    await write(path.join(legacy, 'Paused', 'workstream.md'), { id: 'Paused', title: 'Old paused', state: 'active' })
    await write(path.join(current, 'Paused', 'workstream.md'), { id: 'Paused', title: 'Paused', state: 'paused' })
    await write(path.join(current, 'Deleted', 'workstream.md'), {
      id: 'Deleted',
      state: 'active',
      deletion: { at: '2025-03-15' },
    })
    await write(path.join(current, 'Pilot', 'artifacts', 'Sample', 'workstream.md'), { id: 'Sample', state: 'active' })
    assert({
      given: 'open and closed projects, migrated, paused, deleted and embedded workstreams',
      should: 'supply only active project and canonical workstream intent without duplicate or historical context',
      actual: await loadOwnerInitiatives(config),
      expected: [
        { ref: 'projects/open/Atlas/_project/overview.md', title: 'Atlas', context: 'Alex chooses the pilot scope.' },
        { ref: 'workstreams/Pilot', title: 'Pilot', context: 'Approve the pilot.\nA chosen scope.' },
      ],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
