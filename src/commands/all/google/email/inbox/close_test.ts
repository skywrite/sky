import { spyOn } from 'bun:test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as prompts from '@clack/prompts'
import EmailFollowRegistry from '#shared/models/Follow/EmailFollowRegistry.ts'
import Follow from '#shared/models/Follow/mod.ts'
import { assert, test } from '#test'
import { commandArgs, withGmail } from '../lib/testGmail.ts'
import Close from './close.ts'

test('manual close keeps history active on failure, then archives it as readable YAML', async () => {
  const select = spyOn(prompts, 'select').mockResolvedValue('255')
  let fail = true
  const changes: unknown[] = []
  try {
    await withGmail(
      (url, init) => {
        const route = url.pathname
        if (route.endsWith('/labels'))
          return {
            labels: [
              { id: 'follow', name: 'Sky/Follow', type: 'user' },
              { id: 'archive', name: 'Sky/Archived', type: 'user' },
            ],
          }
        if (route.endsWith('/threads')) return { threads: [{ id: 'ff' }] }
        if (route.endsWith('/threads/ff'))
          return { messages: [{ id: 'a1', threadId: 'ff', labelIds: ['follow', 'INBOX'] }] }
        if (route.endsWith('/modify')) {
          if (fail) return new Response('{}', { status: 400 })
          changes.push(JSON.parse(String(init?.body)))
          return {}
        }
        throw new Error(`Unexpected request ${route}`)
      },
      async (context) => {
        const activeDir = context.config.DIR_STATE_FOLLOW_EMAIL_ACTIVE
        const archiveDir = context.config.DIR_STATE_FOLLOW_EMAIL_ARCHIVE
        await mkdir(activeDir, { recursive: true })
        const follow = Follow.create({
          source: 'Email',
          ref: { account: 'jane@example.com', threadId: '255', label: 'Sky/Follow' },
          summary: 'Atlas planning',
          messages: [{ date: '2025-04-01', path: '2025-04-01/actions/messages/atlas.md' }],
        })
        await writeFile(path.join(activeDir, 'atlas.yaml'), follow.toYaml())
        const args = commandArgs(context, { account: 'jane@example.com', label: 'Sky/Follow' })
        const rejected = await new Close().run(args)
        assert({
          given: 'Gmail rejects manual closure',
          should: 'report failure and retain the active record',
          actual: [rejected.ok, (await EmailFollowRegistry.build(activeDir)).size],
          expected: [false, 1],
        })
        fail = false
        const closed = await new Close().run(args)
        assert({
          given: 'manual closure succeeds',
          should: 'swap the marker and retain a discoverable archived YAML record',
          actual: [
            closed.ok,
            (await EmailFollowRegistry.build(activeDir)).size,
            Follow.fromYaml(await readFile(path.join(archiveDir, 'atlas.yaml'), 'utf8')).status,
            changes,
          ],
          expected: [true, 0, 'closed', [{ addLabelIds: ['archive'], removeLabelIds: ['follow', 'INBOX'] }]],
        })
      },
    )
  } finally {
    select.mockRestore()
  }
})
