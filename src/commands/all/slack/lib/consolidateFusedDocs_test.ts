import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { exists, readTextFile } from '#shared/fs/mod.ts'
import Follow from '#shared/models/Follow/mod.ts'
import { assert, test } from '#test'
import { consolidateFusedDocs } from './consolidateFusedDocs.ts'

const ASK_DOC = `\
---
from: Jane Doe
to: John Roe
when: 2026-02-15 07:10
medium: Slack
summary: Widget check-in request
follow: 2026-02-15_slack_DM-with-John_Widget-check-in-request
link: https://atlas.slack.com/archives/D0ATLAS001/p1750000000000100
tags: Atlas/Widgets
---

# Widget check-in request

## 2026-02-15 07:10 - **Jane Doe**

Interested in a widget check-in this week?
`

const REPLY_DOC = `\
---
from: John Roe
to: Jane Doe
when: 2026-02-15 07:19
medium: Slack
summary: Widget check-in acceptance
follow: 2026-02-15_slack_DM-with-John_Widget-check-in-acceptance
link: https://atlas.slack.com/archives/D0ATLAS001/p1750000000000200
tags: Atlas/Widgets; Atlas/Planning
---

# Widget check-in acceptance

## 2026-02-15 07:19 - **John Roe**

Yes, let's do it. Thursday works.
`

const DAY_MD = `\
# 2026-02-15

- 07:10 > Jane to John Slack -> [Widget check-in request](actions/messages/07-10_slack_Jane-to-John_Widget-check-in-request.md)
- 07:15 > Unrelated line stays
- 07:19 > John to Jane Slack -> [Widget check-in acceptance](actions/messages/07-19_slack_John-to-Jane_Widget-check-in-acceptance.md)
`

const output = { log: () => {} } as unknown as Parameters<typeof consolidateFusedDocs>[2]['output']

test('consolidateFusedDocs() combines same-day fragments into one doc', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'consolidate-test-'))
  const dayDir = path.join(base, 'time/2026/02/09-15/02-15')
  await mkdir(path.join(dayDir, 'actions/messages'), { recursive: true })
  const askRel = 'actions/messages/07-10_slack_Jane-to-John_Widget-check-in-request.md'
  const replyRel = 'actions/messages/07-19_slack_John-to-Jane_Widget-check-in-acceptance.md'
  await writeFile(path.join(dayDir, askRel), ASK_DOC, 'utf-8')
  await writeFile(path.join(dayDir, replyRel), REPLY_DOC, 'utf-8')
  await writeFile(path.join(dayDir, 'day.md'), DAY_MD, 'utf-8')

  const follow = Follow.create({
    source: 'Slack',
    ref: { channel: 'D0ATLAS001', link: 'https://atlas.slack.com/archives/D0ATLAS001/p1750000000000100' },
    merged: [{ channel: 'D0ATLAS001', link: 'https://atlas.slack.com/archives/D0ATLAS001/p1750000000000200' }],
    summary: 'Widget check-in request',
    messages: [
      { date: '2026-02-15', path: `2026-02-15/${askRel}` },
      { date: '2026-02-15', path: `2026-02-15/${replyRel}` },
    ],
  })

  const updated = await consolidateFusedDocs(follow, '2026-02-15_slack_DM-with-John_Widget-check-in-request', {
    output,
    baseDir: base,
  })

  assert({
    given: 'two same-day fragments',
    should: 'leave one ledger entry',
    expected: 1,
    actual: updated.messages.length,
  })
  assert({
    given: 'the absorbed fragment',
    should: 'be deleted from disk',
    expected: false,
    actual: await exists(path.join(dayDir, replyRel)),
  })

  const combined = await readTextFile(path.join(dayDir, askRel))
  assert({
    given: 'the combined doc',
    should: 'hold both messages in order',
    expected: true,
    actual:
      combined.indexOf('Interested in a widget check-in') < combined.indexOf('Thursday works') &&
      combined.includes('## 2026-02-15 07:19 - **John Roe**'),
  })
  assert({
    given: 'the combined doc',
    should: 'carry the fused follow slug',
    expected: true,
    actual: combined.includes('follow: 2026-02-15_slack_DM-with-John_Widget-check-in-request'),
  })
  assert({
    given: 'the fragments’ tags',
    should: 'union',
    expected: true,
    actual: combined.includes('Atlas/Widgets; Atlas/Planning'),
  })

  const dayMd = await readTextFile(path.join(dayDir, 'day.md'))
  assert({
    given: 'the absorbed fragment’s day.md line',
    should: 'be removed, others kept',
    expected: true,
    actual: !dayMd.includes('Widget-check-in-acceptance.md') && dayMd.includes('Unrelated line stays'),
  })
  assert({
    given: 'the surviving day.md line',
    should: 'carry the fused title',
    expected: true,
    actual: dayMd.includes(
      '[Widget check-in request](actions/messages/07-10_slack_Jane-to-John_Widget-check-in-request.md)',
    ),
  })

  await rm(base, { recursive: true })
})

test('consolidateFusedDocs() leaves single-doc days alone apart from identity', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'consolidate-single-'))
  const dayDir = path.join(base, 'time/2026/02/09-15/02-15')
  await mkdir(path.join(dayDir, 'actions/messages'), { recursive: true })
  const askRel = 'actions/messages/07-10_slack_Jane-to-John_Widget-check-in-request.md'
  await writeFile(path.join(dayDir, askRel), ASK_DOC, 'utf-8')
  await writeFile(path.join(dayDir, 'day.md'), DAY_MD, 'utf-8')

  const follow = Follow.create({
    source: 'Slack',
    ref: { channel: 'D0ATLAS001', link: 'https://atlas.slack.com/archives/D0ATLAS001/p1750000000000100' },
    merged: [{ channel: 'D0ATLAS001', link: 'https://atlas.slack.com/archives/D0ATLAS001/p1750000000000300' }],
    summary: 'Widget check-in request',
    messages: [{ date: '2026-02-15', path: `2026-02-15/${askRel}` }],
  })

  const updated = await consolidateFusedDocs(follow, 'the-fused-slug', { output, baseDir: base })

  assert({ given: 'one doc on the day', should: 'keep one entry', expected: 1, actual: updated.messages.length })
  const doc = await readTextFile(path.join(dayDir, askRel))
  assert({
    given: 'the lone doc',
    should: 'still get the fused slug',
    expected: true,
    actual: doc.includes('follow: the-fused-slug'),
  })
  assert({
    given: 'the lone doc',
    should: 'keep its single message',
    expected: true,
    actual: doc.includes('Interested in a widget check-in'),
  })

  await rm(base, { recursive: true })
})
