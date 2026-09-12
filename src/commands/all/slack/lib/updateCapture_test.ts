import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import MessageDocument from '#shared/models/Message/mod.ts'
import { parseSlackConversation } from '#shared/models/Message/slack/parse.ts'
import { slackAttachmentFile, updateSlackConversation } from '#shared/models/Message/slack/write.ts'
import dayAttachmentsDir from '#shared/nbfs/dayAttachmentsDir.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import type { SlackCaptureMessage } from './captureMessages.ts'
import { updateSlackCapture } from './updateCapture.ts'

const day = new PlainDate('2026-04-10')
const output = { log: () => {} }
const source = (ts: string, text = ''): SlackCaptureMessage => ({
  channelId: 'C0ATLAS',
  ts,
  timeLabel: '2026-04-10 09:00',
  userName: 'Jane Doe',
  text,
})
const doc = (markdown = '') =>
  new MessageDocument(
    {
      medium: 'Slack',
      when: '2026-04-10 09:00',
      summary: 'Atlas',
      tags: 'Atlas/Review',
      rel: ['projects/Atlas'],
      follow: 'atlas-follow',
    },
    markdown,
  )

test('Slack capture preserves same-named originals, message ownership and repeat captures', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'slack-capture-test-'))
  try {
    const firstPath = path.join(temp, 'first.pdf')
    const secondPath = path.join(temp, 'second.pdf')
    await writeFile(firstPath, 'first original')
    await writeFile(secondPath, 'second original')
    const messages = [
      { ...source('1770000000.000001'), files: [{ id: 'F0FIRST', name: 'report [1].pdf', path: firstPath }] },
      { ...source('1770000000.000002'), files: [{ id: 'F0SECOND', name: 'report [1].pdf', path: secondPath }] },
    ]
    const saved = await updateSlackCapture({ doc: doc(), messages, day, output, attachmentsRoot: temp })
    const parsed = parseSlackConversation(saved.markdown)
    const attachDir = path.join(temp, dayAttachmentsDir(day))
    assert({
      given: 'two attachment-only messages with identically named files',
      should: 'preserve both originals and sender associations',
      actual: [
        parsed.messages.map((message) => message.attachmentIds),
        await Promise.all(saved.attachments.map((file) => readFile(path.join(attachDir, file.file), 'utf8'))),
      ],
      expected: [
        [['attachment-slack-F0FIRST'], ['attachment-slack-F0SECOND']],
        ['first original', 'second original'],
      ],
    })
    assert({
      given: 'filenames requiring Markdown escaping',
      should: 'retain working links to both stored files',
      actual: parsed.attachments.map(slackAttachmentFile),
      expected: saved.attachments.map((file) => file.file),
    })
    const repeated = await updateSlackCapture({
      doc: MessageDocument.fromMarkdown(saved.toMarkdown()),
      messages,
      day,
      output,
      attachmentsRoot: temp,
    })
    assert({
      given: 'a repeated export',
      should: 'leave document bytes and file count unchanged',
      actual: [repeated.toMarkdown(), (await readdir(path.join(attachDir, 'atlas-follow'))).length],
      expected: [saved.toMarkdown(), 2],
    })
    const expiredDownloads = messages.map((message) => ({
      ...message,
      files: message.files.map((file) => ({ ...file, path: undefined, error: 'Expired download' })),
    }))
    assert({
      given: 'provider IDs already saved but download paths no longer available',
      should: 'reuse the preserved originals',
      actual: (
        await updateSlackCapture({ doc: saved, messages: expiredDownloads, day, output, attachmentsRoot: temp })
      ).toMarkdown(),
      expected: saved.toMarkdown(),
    })
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})

test('Slack capture recovers legacy file ownership by matching bytes and preserves unknown metadata', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'slack-legacy-test-'))
  try {
    const attachDir = path.join(temp, dayAttachmentsDir(day))
    await mkdir(attachDir, { recursive: true })
    await writeFile(path.join(attachDir, 'renamed-image.png'), 'original image bytes')
    await writeFile(path.join(attachDir, 'unmatched.pdf'), 'unmatched original')
    const downloaded = path.join(temp, 'F0PHOTO.png')
    await writeFile(downloaded, 'original image bytes')
    const original = new MessageDocument(
      {
        ...doc().yaml,
        follow: 'atlas-follow',
        previous: '09/messages/atlas',
        custom: { keep: true },
        attachments: [
          { file: 'renamed-image.png', rel: 'projects/Atlas', custom: 'retain' },
          { file: 'unmatched.pdf' },
        ],
      },
      '# Atlas\n\n## 2026-04-10 09:00 - **Jane Doe**\n\n(empty)\n\n## Notes\n\nKeep this note.\n',
    )
    const messages = [
      { ...source('1770000000.000001'), files: [{ id: 'F0PHOTO', name: 'image.png', path: downloaded }] },
    ]
    const saved = await updateSlackCapture({ doc: original, messages, day, output, attachmentsRoot: temp })
    const parsed = parseSlackConversation(saved.markdown)
    assert({
      given: 'an old flattened attachment list and a freshly fetched original',
      should: 'restore verified ownership and keep the filenames inside the follow folder',
      actual: [
        parsed.messages[0].attachmentIds,
        parsed.attachments.map((file) => [file.name, slackAttachmentFile(file)]),
        (await readdir(path.join(attachDir, 'atlas-follow'))).sort(),
      ],
      expected: [
        ['attachment-slack-F0PHOTO'],
        [
          ['image.png', 'atlas-follow/renamed-image.png'],
          ['unmatched.pdf', 'atlas-follow/unmatched.pdf'],
        ],
        ['renamed-image.png', 'unmatched.pdf'],
      ],
    })
    assert({
      given: 'manual metadata and notes in the legacy document',
      should: 'retain them through conversion',
      actual: [saved.yaml, saved.markdown.includes('## Notes\n\nKeep this note.')],
      expected: [
        {
          ...original.yaml,
          attachments: [
            { file: 'atlas-follow/renamed-image.png', rel: 'projects/Atlas', custom: 'retain' },
            { file: 'atlas-follow/unmatched.pdf' },
          ],
        },
        true,
      ],
    })
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})

test('Slack capture does not save download-error receipts as original attachments', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'slack-unavailable-test-'))
  try {
    const receipt = path.join(temp, 'F0FILE.download-error.txt')
    await writeFile(receipt, 'Not authorized')
    let error = ''
    try {
      await updateSlackCapture({
        doc: doc(),
        messages: [
          {
            ...source('1770000000.000001'),
            files: [{ id: 'F0FILE', name: 'report.pdf', path: receipt, error: 'Download failed' }],
          },
        ],
        day,
        output,
        attachmentsRoot: temp,
      })
    } catch (caught) {
      error = String(caught)
    }
    assert({
      given: 'agent-slack returned a download error with a receipt path',
      should: 'fail before a document can be saved and keep the receipt out of attachments',
      actual: [error.includes('unavailable'), await readdir(path.join(temp, dayAttachmentsDir(day))).catch(() => [])],
      expected: [true, []],
    })
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})

test('Slack captures isolate follows and relocate saved entries without changing their identity', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'slack-folders-test-'))
  try {
    const attachDir = path.join(temp, dayAttachmentsDir(day))
    await mkdir(attachDir, { recursive: true })
    const file = 'report [1].pdf'
    await writeFile(path.join(attachDir, file), 'legacy original')
    const body =
      updateSlackConversation('# Atlas\n\n', [
        {
          id: 'message-slack-C0ATLAS-1770000000-000001',
          timestamp: '2026-04-10 09:00',
          author: 'Jane Doe',
          text: 'Review this report.',
          attachments: [{ id: 'attachment-slack-F0REPORT', name: file, file }],
        },
      ]) + '\nA hand-written attachment summary.\n'
    const original = new MessageDocument({ ...doc().yaml, attachments: [{ file, custom: 'keep' }] }, body)
    const first = await updateSlackCapture({ doc: original, messages: [], day, output, attachmentsRoot: temp })
    assert({
      given: 'a saved attachment in the day root with an existing ID and summary',
      should: 'change only its path while keeping the original available until the save succeeds',
      actual: [
        first.yaml,
        first.markdown,
        await readFile(path.join(attachDir, first.attachments[0].file), 'utf8'),
        await readFile(path.join(attachDir, file), 'utf8'),
      ],
      expected: [
        { ...original.yaml, attachments: [{ file: `atlas-follow/${file}`, custom: 'keep' }] },
        body.replace('(<report%20%5B1%5D.pdf>)', '(<atlas-follow/report%20%5B1%5D.pdf>)'),
        'legacy original',
        'legacy original',
      ],
    })
    const other = new MessageDocument({ ...first.yaml, follow: 'widget-follow' }, first.markdown)
    await mkdir(path.join(attachDir, 'widget-follow'), { recursive: true })
    await writeFile(path.join(attachDir, 'widget-follow', file), 'different original')
    const moved = await updateSlackCapture({ doc: other, messages: [], day, output, attachmentsRoot: temp })
    const repeat = await updateSlackCapture({ doc: moved, messages: [], day, output, attachmentsRoot: temp })
    assert({
      given: 'a merged follow whose folder already contains a different file with the same name',
      should: 'keep both originals and make repeat saves stable',
      actual: [
        moved.attachments[0].file,
        parseSlackConversation(moved.markdown).attachments.map((a) => [a.id, slackAttachmentFile(a)]),
        await readFile(path.join(attachDir, 'widget-follow', file), 'utf8'),
        await readFile(path.join(attachDir, moved.attachments[0].file), 'utf8'),
        repeat.toMarkdown(),
      ],
      expected: [
        'widget-follow/report [1]_2.pdf',
        [['attachment-slack-F0REPORT', 'widget-follow/report [1]_2.pdf']],
        'different original',
        'legacy original',
        moved.toMarkdown(),
      ],
    })
    const capture = await updateSlackCapture({
      doc: new MessageDocument({ ...doc().yaml, follow: undefined }, ''),
      captureSlug: '2026-04-10_090000_Slack-Atlas',
      messages: [
        { ...source('1770000000.000002'), files: [{ id: 'F0OTHER', name: file, path: path.join(attachDir, file) }] },
      ],
      day,
      output,
      attachmentsRoot: temp,
    })
    assert({
      given: 'a one-off capture with no follow',
      should: 'use its document slug as the folder',
      actual: capture.attachments[0].file.split('/')[0],
      expected: '2026-04-10_090000_Slack-Atlas',
    })
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})
