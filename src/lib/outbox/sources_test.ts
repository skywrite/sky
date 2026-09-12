import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { resolveTimeRef } from '#shared/nbfs/timeRef.ts'
import { assert, test } from '#test'
import { SavedMessages } from './sources.ts'

test('Outbox indexes old and new Slack messages while excluding attachment and example timestamps', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-slack-sources-'))
  const sources = new SavedMessages(root, { Slack: [], Email: [] })
  const ref = '2025-03-15/actions/messages/slack_Atlas.md'
  try {
    const file = path.join(root, resolveTimeRef(ref))
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(
      file,
      `---
from: Jane Doe
to: John Smith
medium: Slack
when: 2025-03-15 08:00
---

# Topic

## 2025-03-15 09:00 - **Jane Doe**

Earlier message.

## Conversation

### 2025-03-15 25:30 - **John Smith**

[drawing.pdf](#attachment-a1)

\u0060\u0060\u0060markdown
## 2025-03-18 10:00 - **Jane Doe**
\u0060\u0060\u0060

## Attachments

<a id="attachment-a1"></a>

### 2025-03-19 10:00 - **Jane Doe**

[Original](drawing.pdf)
`,
    )
    const current = await sources.discover(null, '2025-03-16')
    const falseMatch = await sources.discover(current, '2025-03-18')
    const attachmentMatch = await sources.discover(current, '2025-03-19')
    const stale = structuredClone(current)
    stale.entries![ref].times = ['2025-03-15 08:00']
    delete stale.entries![ref].parserVersion
    const refreshed = await sources.discover(stale, '2025-03-16')
    assert({
      given: 'mixed headings, an extended hour, and unchanged metadata cached by the old reader',
      should:
        'find actual next-day activity and rebuild stale timestamps without treating examples or filenames as messages',
      actual: [
        current.entries![ref].times,
        current.pending,
        falseMatch.pending,
        attachmentMatch.pending,
        refreshed.pending,
      ],
      expected: [['2025-03-15 09:00', '2025-03-16 01:30'], [ref], [], [], [ref]],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
