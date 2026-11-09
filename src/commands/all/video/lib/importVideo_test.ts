import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { attachmentDestination } from '#service/handler/attachments/mod.ts'
import { Document } from '#shared/models/Markdown/mod.ts'
import VideoDocument from '#shared/models/Video/mod.ts'
import { dayDir, dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { completeVideoBody, videoContent } from './content.ts'
import { importVideo, planVideoImport, videoSource, type VideoImportOptions } from './importVideo.ts'

const URL = 'https://www.loom.com/share/0123456789abcdef0123456789abcdef'
const WHEN = new PlainDateTime('2031-04-05 09:30')
const WORDS = 'Hello Atlas team, this is the complete demonstration transcript.'
const WRITEUP =
  '## Summary\n\nThe Atlas demonstration explains the proposed product workflow.\n\n## Key Points\n\n- Review the sample workflow.'

async function fixture(run: (options: VideoImportOptions, root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-video-import-test-'))
  const base = path.join(root, 'notebook')
  const data = path.join(root, 'data')
  await mkdir(base)
  const video = path.join(root, 'sample.mp4')
  const transcript = path.join(root, 'sample.txt')
  await writeFile(video, 'synthetic recording bytes')
  await writeFile(transcript, WORDS)
  try {
    await run(
      {
        config: {
          DIR_BASE: base,
          DIR_TIME: path.join(base, 'time'),
          DIR_USER_DATA: data,
          DIR_ATTACHMENTS: path.join(data, 'attachments'),
          DIR_STATE: path.join(data, 'state'),
        },
        url: URL,
        when: WHEN,
        title: 'Atlas API demonstration',
        timezone: 'UTC',
        category: 'Professional Complete',
        videoFile: video,
        transcriptFile: transcript,
        prepare: async () => ({ body: WRITEUP, cleanedText: WORDS }),
      },
      root,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('video import previews without model calls or notebook/media/state writes', async () => {
  await fixture(async (options) => {
    let calls = 0
    const result = await importVideo({
      ...options,
      dryRun: true,
      prepare: async () => {
        calls++
        throw new Error('Must not run')
      },
    })
    assert({
      given: 'a dry-run preview of a new recording',
      should: 'plan creation without generating or writing anything',
      actual: {
        action: result.plan.action,
        missing: result.plan.missing,
        calls,
        notebook: await readdir(options.config.DIR_BASE),
        data: await readdir(options.config.DIR_USER_DATA).catch(() => []),
      },
      expected: { action: 'create', missing: ['video', 'transcript', 'summary'], calls: 0, notebook: [], data: [] },
    })
  })
})

test('a complete video import keeps originals and reruns by Loom ID without duplicate notes or model calls', async () => {
  await fixture(async (options) => {
    let calls = 0
    const input = {
      ...options,
      recordedAt: '2031-04-05T09:30:45Z',
      prepare: async () => {
        calls++
        return { body: WRITEUP, cleanedText: WORDS }
      },
    }
    const first = await importVideo(input)
    const second = await importVideo({ ...input, url: URL.replace('/share/', '/embed/') + '?source=sample' })
    const doc = VideoDocument.fromMarkdown(await readFile(first.filePath!, 'utf8'))
    assert({
      given: 'the same Loom recording imported through share and embed URLs',
      should: 'keep one complete entry, exact source timestamp, and untouched originals',
      actual: {
        same: first.filePath === second.filePath,
        action: second.plan.action,
        calls,
        body: videoContent(doc.markdown),
        url: doc.videoUrl,
        recordedAt: (doc.yaml.video as { recorded_at?: string }).recorded_at,
        originalVideo: await readFile(options.videoFile!, 'utf8'),
        originalTranscript: await readFile(options.transcriptFile!, 'utf8'),
        readable: first.filePath!.endsWith('Loom_Atlas-API-demonstration.md'),
      },
      expected: {
        same: true,
        action: 'skip',
        calls: 1,
        body: { summary: true, transcript: true, transcriptText: WORDS },
        url: URL,
        recordedAt: '2031-04-05T09:30:45Z',
        originalVideo: 'synthetic recording bytes',
        originalTranscript: WORDS,
        readable: true,
      },
    })
  })
})

test('source imports use the generated speaker and summary for descriptive note and attachment names', async () => {
  await fixture(async (options) => {
    const result = await importVideo({
      ...options,
      title: undefined,
      prepare: async () => ({ body: WRITEUP, cleanedText: WORDS, title: 'API Review', from: 'Jane Doe' }),
    })
    const doc = VideoDocument.fromMarkdown(await readFile(result.filePath!, 'utf8'))
    assert({
      given: 'speaker and summary metadata produced while preparing a source import',
      should: 'use the same convention as transcript imports and retain the day on attachments',
      actual: {
        note: path.basename(result.filePath!),
        attachments: doc.yaml.attachments,
        from: doc.yaml.from,
        summary: doc.summary,
      },
      expected: {
        note: 'Loom_Jane-Doe_API-Review.md',
        attachments: [
          { file: '2031-04-05_Loom_Jane-Doe_API-Review.mp4' },
          { file: '2031-04-05_Loom_Jane-Doe_API-Review.txt' },
        ],
        from: 'Jane Doe',
        summary: 'API Review',
      },
    })
  })
})

test('distinct source IDs with the same descriptive name preserve both recordings and remain idempotent', async () => {
  await fixture(async (options, root) => {
    const otherVideo = path.join(root, 'other.mp4')
    await writeFile(otherVideo, 'another synthetic recording')
    const inputs = [
      { ...options, from: 'Jane Doe' },
      {
        ...options,
        from: 'Jane Doe',
        url: 'https://www.loom.com/share/fedcba9876543210fedcba9876543210',
        videoFile: otherVideo,
      },
    ]
    const results = await Promise.all(inputs.map((input) => importVideo(input)))
    const docs = await Promise.all(
      results.map(async (result) => VideoDocument.fromMarkdown(await readFile(result.filePath!, 'utf8'))),
    )
    const recordings = await Promise.all(
      docs.map(async (doc, index) => {
        const attachment = (doc.yaml.attachments as { file: string }[]).find((item) => item.file.endsWith('.mp4'))!
        const result = results[index]
        const destination = attachmentDestination(
          path.relative(options.config.DIR_BASE, result.filePath!),
          options.config.DIR_USER_DATA,
        )
        return readFile(path.join(destination.dir, attachment.file), 'utf8')
      }),
    )
    const retries = await Promise.all(
      inputs.map((input) =>
        importVideo({
          ...input,
          prepare: async () => {
            throw new Error('A retry must not regenerate content')
          },
        }),
      ),
    )
    assert({
      given: 'two different recordings imported concurrently with identical day, person and summary',
      should: 'allocate a numeric suffix without overwriting media or duplicating either recording on retry',
      actual: {
        names: results.map((result) => path.basename(result.filePath!)).sort(),
        recordings: recordings.sort(),
        same: retries.every(
          (retry, index) => retry.filePath === results[index].filePath && retry.plan.action === 'skip',
        ),
      },
      expected: {
        names: ['Loom_Jane-Doe_Atlas-API-demonstration-2.md', 'Loom_Jane-Doe_Atlas-API-demonstration.md'],
        recordings: ['another synthetic recording', 'synthetic recording bytes'],
        same: true,
      },
    })
  })
})

test('matching an old Loom entry fills transcript and summary while retaining notes, metadata, dates and concurrent edits', async () => {
  await fixture(async (options, root) => {
    const file = path.join(options.config.DIR_BASE, 'legacy-video.md')
    const original = '# Original notes\n\nKeep the original message and decisions exactly.\n'
    const initial = new VideoDocument({
      when: new PlainDateTime('2031-04-07 14:10'),
      summary: 'Original title',
      tags: 'Atlas',
      custom: 'preserve',
      attachments: [{ file: 'original.pdf', annotation: 'Keep this annotation', rel: 'Atlas, Jane Doe' }],
      video: { url: URL },
      body: original,
    }).toMarkdown()
    await writeFile(file, initial)
    const result = await importVideo({
      ...options,
      prepare: async (plan) => {
        assert({
          given: 'an older entry filed on a different date',
          should: 'retain its existing date for processing',
          actual: plan.when,
          expected: '2031-04-07 14:10',
        })
        await writeFile(file, initial + '\nAn edit made while the model was working.\n')
        return { body: WRITEUP, cleanedText: WORDS }
      },
    })
    const doc = VideoDocument.fromMarkdown(await readFile(file, 'utf8'))
    assert({
      given: 'a duplicate ID with missing content and an edit made during processing',
      should: 'fill the original entry without changing its identity, metadata or notes',
      actual: {
        same: result.filePath === file,
        notes: doc.markdown.startsWith(original + '\nAn edit made while the model was working.\n'),
        when: doc.when.datetime.toString(),
        title: doc.summary,
        custom: doc.yaml.custom,
        attachmentMetadata: (doc.yaml.attachments as Record<string, unknown>[])[0],
        complete: (await planVideoImport(options)).action,
        extraFiles: (await readdir(options.config.DIR_BASE)).filter((name) => name.endsWith('.md')),
        originalExists: await readFile(path.join(root, 'sample.txt'), 'utf8'),
      },
      expected: {
        same: true,
        notes: true,
        when: '2031-04-07 14:10',
        title: 'Original title',
        custom: 'preserve',
        attachmentMetadata: { file: 'original.pdf', annotation: 'Keep this annotation', rel: 'Atlas, Jane Doe' },
        complete: 'skip',
        extraFiles: ['legacy-video.md'],
        originalExists: WORDS,
      },
    })
  })
})

test('filling a legacy video preserves channel fields and quotes a concurrent channel edit', async () => {
  await fixture(async (options) => {
    const file = path.join(options.config.DIR_BASE, 'legacy-channels.md')
    const initial = `---
who: #atlas-owners
from: #atlas-source
to: #atlas-review
when: 2031-04-07 14:10
custom: keep
video:
  url: ${URL}
---

# Original notes

Keep the original decisions.
`
    await writeFile(file, initial)
    let calls = 0
    const input = {
      ...options,
      prepare: async () => {
        calls++
        await writeFile(file, initial.replace('who: #atlas-owners', 'who: #atlas-planning'))
        return { body: WRITEUP, cleanedText: WORDS }
      },
    }
    const first = await importVideo(input)
    const saved = await readFile(file, 'utf8')
    const doc = Document.fromMarkdown(saved)
    const again = await importVideo(input)
    assert({
      given: 'legacy channel literals and a participant edit made during generation',
      should: 'retain the latest channel values as real YAML strings and keep retries unchanged',
      actual: {
        same: first.filePath === file && again.filePath === file,
        fields: { who: doc.yaml.who, from: doc.yaml.from, to: doc.yaml.to },
        quoted: ['who', 'from', 'to'].every((key) => saved.includes(`${key}: "#atlas-`)),
        when: doc.yaml.when,
        custom: doc.yaml.custom,
        notes: doc.markdown.startsWith('# Original notes\n\nKeep the original decisions.\n'),
        calls,
        unchanged: (await readFile(file, 'utf8')) === saved,
      },
      expected: {
        same: true,
        fields: { who: '#atlas-planning', from: '#atlas-source', to: '#atlas-review' },
        quoted: true,
        when: '2031-04-07 14:10',
        custom: 'keep',
        notes: true,
        calls: 1,
        unchanged: true,
      },
    })
  })
})

test('an existing transcript supplies a missing summary without replacing the transcript or requiring its source file', async () => {
  await fixture(async (options) => {
    const file = path.join(options.config.DIR_BASE, 'legacy-video.md')
    await writeFile(
      file,
      new VideoDocument({
        when: WHEN,
        video: { url: URL },
        body: `# Loom\n\n## Transcript\n\n${WORDS}\n`,
      }).toMarkdown(),
    )
    let supplied = ''
    await importVideo({
      ...options,
      transcriptFile: undefined,
      prepare: async (_plan, existing) => {
        supplied = existing
        return { body: WRITEUP }
      },
    })
    const doc = VideoDocument.fromMarkdown(await readFile(file, 'utf8'))
    assert({
      given: 'a transcript already in the entry',
      should: 'use it to create the missing summary once',
      actual: {
        supplied,
        transcriptCount: doc.markdown.split(WORDS).length - 1,
        summary: videoContent(doc.markdown).summary,
        summaryFirst: doc.markdown.indexOf('## Imported summary') < doc.markdown.indexOf('## Transcript'),
      },
      expected: { supplied: WORDS, transcriptCount: 1, summary: true, summaryFirst: true },
    })
  })
})

test('multiple entries sharing a Loom ID are surfaced for review without modifying either file', async () => {
  await fixture(async (options) => {
    const text = new VideoDocument({ when: WHEN, video: { url: URL }, body: '# Existing notes\n' }).toMarkdown()
    await Promise.all(['one.md', 'two.md'].map((name) => writeFile(path.join(options.config.DIR_BASE, name), text)))
    const plan = await planVideoImport(options)
    let error = ''
    try {
      await importVideo(options)
    } catch (problem) {
      error = (problem as Error).message
    }
    assert({
      given: 'two existing entries for the same provider ID',
      should: 'require destination review even when importing would otherwise fill missing content',
      actual: {
        action: plan.action,
        matches: plan.matches.length,
        refused: error.includes('Multiple Sky entries'),
        unchanged: (await readFile(plan.matches[0], 'utf8')) === text,
      },
      expected: { action: 'review', matches: 2, refused: true, unchanged: true },
    })
  })
})

test('summary placeholders are incomplete and completion preserves original notes', () => {
  const body = '# Loom\n\n## Summary\n\n(insert summary here)\n\n## Transcript\n'
  const filled = completeVideoBody(body, { body: WRITEUP, cleanedText: WORDS })
  assert({
    given: 'a legacy template with empty sections',
    should: 'fill template sections with the summary before the transcript once',
    actual: {
      before: videoContent(body),
      after: videoContent(filled),
      summaryFirst: filled.indexOf('## Imported summary') < filled.indexOf('## Transcript'),
      transcriptHeadings: filled.split('## Transcript').length - 1,
      stable: completeVideoBody(filled, { body: WRITEUP, cleanedText: WORDS }) === filled,
    },
    expected: {
      before: { summary: false, transcript: false, transcriptText: '' },
      after: { summary: true, transcript: true, transcriptText: WORDS },
      summaryFirst: true,
      transcriptHeadings: 1,
      stable: true,
    },
  })
  assert({
    given: 'Loom URL variations',
    should: 'normalize by provider ID',
    actual: videoSource(URL.toUpperCase().replace('WWW.', 'www.')).loomId,
    expected: '0123456789abcdef0123456789abcdef',
  })
})

test('an interruption after publishing the note repairs its day link without another model call or note', async () => {
  await fixture(async (options) => {
    const day = path.join(options.config.DIR_TIME, dayFile(WHEN.plainDate))
    await mkdir(day, { recursive: true })
    let calls = 0
    const input = {
      ...options,
      prepare: async () => {
        calls++
        return { body: WRITEUP, cleanedText: WORDS }
      },
    }
    let failed = false
    try {
      await importVideo(input)
    } catch {
      failed = true
    }
    const published = await planVideoImport(options)
    await rm(day, { recursive: true })
    const recovered = await importVideo(input)
    const again = await importVideo(input)
    const dayText = await readFile(day, 'utf8')
    assert({
      given: 'a day-file write failure after the complete video note was published',
      should: 'repair its day link once and reuse the existing note and generated text',
      actual: {
        failed,
        published: published.action,
        calls,
        same: recovered.filePath === again.filePath,
        links: dayText.split(path.basename(recovered.filePath!)).length - 1,
      },
      expected: { failed: true, published: 'skip', calls: 1, same: true, links: 1 },
    })
  })
})

test('cancelled processing leaves the original sources and notebook unchanged', async () => {
  await fixture(async (options) => {
    const controller = new AbortController()
    let cancelled = false
    try {
      await importVideo({
        ...options,
        signal: controller.signal,
        prepare: async () => {
          controller.abort()
          return { body: WRITEUP, cleanedText: WORDS }
        },
      })
    } catch {
      cancelled = true
    }
    assert({
      given: 'cancellation while generating the missing text',
      should: 'publish no notebook entry or media copies',
      actual: {
        cancelled,
        files: await readdir(options.config.DIR_BASE),
        media: await readdir(options.config.DIR_ATTACHMENTS).catch(() => []),
        source: await readFile(options.transcriptFile!, 'utf8'),
      },
      expected: { cancelled: true, files: [], media: [], source: WORDS },
    })
  })
})

test('an incomplete generation cannot publish a partial entry or media files', async () => {
  await fixture(async (options) => {
    let refused = false
    try {
      await importVideo({ ...options, prepare: async () => ({ body: WRITEUP }) })
    } catch {
      refused = true
    }
    assert({
      given: 'a missing transcript that the pipeline did not produce',
      should: 'stop before filing or copying media',
      actual: {
        refused,
        notebook: await readdir(options.config.DIR_BASE),
        media: await readdir(options.config.DIR_ATTACHMENTS).catch(() => []),
      },
      expected: { refused: true, notebook: [], media: [] },
    })
  })
})

test('legacy entries without full header dates keep their folder date and original metadata', async () => {
  await fixture(async (options) => {
    const date = new PlainDateTime('2031-04-08 11:45')
    const file = path.join(options.config.DIR_TIME, dayDir(date.plainDate), 'legacy.md')
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, `---\nwhen: '11:45'\nvideo:\n  url: ${URL}\n---\n\n# Original notes\nKeep these notes.\n`)
    let processedWhen = ''
    await importVideo({
      ...options,
      prepare: async (plan) => {
        processedWhen = plan.when
        return { body: WRITEUP, cleanedText: WORDS }
      },
    })
    const doc = VideoDocument.fromMarkdown(await readFile(file, 'utf8'))
    assert({
      given: 'a legacy clock-only header filed on a day different from the recording',
      should: 'anchor processing to its existing folder date and preserve the original header value',
      actual: { processedWhen, header: doc.yaml.when, complete: (await planVideoImport(options)).action },
      expected: { processedWhen: '2031-04-08 11:45', header: '11:45', complete: 'skip' },
    })
  })
})

test('legacy source metadata is filled in place and aliases reuse the same recording', async () => {
  const alias = `https://www.loom.com/share/${'1'.repeat(32)}`
  const formats = [
    { metadata: { video: { loom: { url: URL }, backup: { url: 'https://example.com/backup' } } }, source: URL },
    { metadata: { url: URL }, source: URL },
    { metadata: { video: [{ url: URL }] }, source: URL },
    { metadata: { video: { url: URL, aliases: [alias] } }, source: alias },
  ]
  for (const format of formats) {
    await fixture(async (options) => {
      const file = path.join(options.config.DIR_BASE, 'legacy.md')
      const yaml = { when: '2031-04-08 25:15', context: 'Atlas original context', ...format.metadata }
      const original = '# Original notes\n\nKeep this text and its date.\n'
      await writeFile(file, new Document(yaml, original).toMarkdown())
      let calls = 0
      const input = {
        ...options,
        url: format.source,
        prepare: async () => {
          calls++
          return { body: WRITEUP, cleanedText: WORDS }
        },
      }
      const first = await importVideo(input)
      const again = await importVideo({ ...input, url: URL })
      const doc = Document.fromMarkdown(await readFile(file, 'utf8'))
      const { attachments: _attachments, ...metadata } = doc.yaml
      assert({
        given: 'an old source shape or an explicitly verified alternate recording URL',
        should: 'complete one existing note without changing metadata, date, original text or source URLs',
        actual: {
          same: first.filePath === file && again.filePath === file,
          calls,
          metadata,
          prefix: doc.markdown.startsWith(original),
          when: first.plan.when,
          action: again.plan.action,
          files: (await readdir(options.config.DIR_BASE)).filter((name) => name.endsWith('.md')),
        },
        expected: {
          same: true,
          calls: 1,
          metadata: yaml,
          prefix: true,
          when: '2031-04-08 25:15',
          action: 'skip',
          files: ['legacy.md'],
        },
      })
    })
  }
})

test('conflicting stored-video associations require review before any collection clip is filed', async () => {
  await fixture(async (options, root) => {
    const other = `https://www.loom.com/share/${'1'.repeat(32)}`
    const originals = new Map<string, string>()
    for (const name of ['first', 'second']) {
      const media = path.join(root, `${name}.mp4`)
      const file = path.join(options.config.DIR_BASE, `${name}.md`)
      await writeFile(media, `${name} recording bytes`)
      const text = new Document({ video: [{ url: URL, file: media }, { url: other }] }, '# Collection\n').toMarkdown()
      originals.set(file, text)
      await writeFile(file, text)
    }
    const plan = await planVideoImport(options)
    let refused = false
    let calls = 0
    try {
      await importVideo({
        ...options,
        prepare: async () => {
          calls++
          return { body: WRITEUP, cleanedText: WORDS }
        },
      })
    } catch {
      refused = true
    }
    assert({
      given: 'two different stored files explicitly assigned to one source',
      should: 'report the ambiguous association and leave both collections unchanged',
      actual: {
        action: plan.action,
        refused,
        calls,
        unchanged: (
          await Promise.all([...originals].map(async ([file, text]) => (await readFile(file, 'utf8')) === text))
        ).every(Boolean),
      },
      expected: { action: 'review', refused: true, calls: 0, unchanged: true },
    })
  })
})

test('removing a source association during generation cannot silently create another recording', async () => {
  await fixture(async (options) => {
    const alias = `https://www.loom.com/share/${'1'.repeat(32)}`
    const file = path.join(options.config.DIR_BASE, 'legacy.md')
    const original = new Document(
      { when: WHEN.toString(), video: { url: URL, aliases: [alias] } },
      '# Original notes\n',
    ).toMarkdown()
    const edited = new Document(
      { when: WHEN.toString(), video: { url: URL } },
      '# Original notes\n\nAn edit made during processing.\n',
    ).toMarkdown()
    await writeFile(file, original)
    let refused = false
    try {
      await importVideo({
        ...options,
        url: alias,
        prepare: async () => {
          await writeFile(file, edited)
          return { body: WRITEUP, cleanedText: WORDS }
        },
      })
    } catch {
      refused = true
    }
    assert({
      given: 'a source alias removed while the model was working',
      should: 'preserve the edit and require review instead of creating another note',
      actual: { refused, text: await readFile(file, 'utf8'), files: await readdir(options.config.DIR_BASE) },
      expected: { refused: true, text: edited, files: ['legacy.md'] },
    })
  })
})

test('body links remain references and do not turn a message into a video entry', async () => {
  await fixture(async (options) => {
    const file = path.join(options.config.DIR_BASE, 'message.md')
    const original = new Document({ medium: 'Email' }, `Watch this demonstration: ${URL}\n`).toMarkdown()
    await writeFile(file, original)
    const plan = await planVideoImport(options)
    assert({
      given: 'a message that mentions the recording in its body',
      should: 'plan a separate recording entry and preserve the message',
      actual: { action: plan.action, matches: plan.matches, message: await readFile(file, 'utf8') },
      expected: { action: 'create', matches: [], message: original },
    })
  })
})

test('grouped video notes retain their index and each clip gets its own content and correct media', async () => {
  await fixture(async (options) => {
    const secondUrl = `https://www.loom.com/share/${'1'.repeat(32)}`
    const group = path.join(options.config.DIR_TIME, dayDir(WHEN.plainDate), 'collection.md')
    await mkdir(path.dirname(group), { recursive: true })
    const mediaDir = path.join(options.config.DIR_ATTACHMENTS, '2031', '04', '05')
    await mkdir(mediaDir, { recursive: true })
    const stored = path.join(mediaDir, 'second.mp4')
    await writeFile(stored, 'stored second recording')
    const metadata = {
      video: [{ url: URL }, { url: secondUrl, file: 'second.mp4' }],
      attachments: [{ file: 'second.mp4', annotation: 'Keep this annotation' }],
    }
    const original = new Document(
      metadata,
      `${WRITEUP}\n\n## Transcript\n\nAn unrelated collection transcript is already here.\n`,
    ).toMarkdown()
    await writeFile(group, original)
    let calls = 0
    const input = (url: string, title: string, transcript: string) => ({
      ...options,
      url,
      title,
      videoFile: url === secondUrl ? undefined : options.videoFile,
      prepare: async () => {
        calls++
        return { body: WRITEUP, cleanedText: transcript }
      },
    })
    const second = input(
      secondUrl,
      'Widget demonstration',
      'The Widget recording contains its own complete transcript.',
    )
    const preview = await importVideo({ ...second, dryRun: true })
    assert({
      given: 'a collection with one source explicitly associated with an existing video',
      should: 'preview a separate clip and its reusable media without changing the index',
      actual: {
        action: preview.plan.action,
        groups: preview.plan.sourceGroups,
        media: preview.plan.reuseVideoFile,
        calls,
        group: await readFile(group, 'utf8'),
      },
      expected: { action: 'create', groups: [group], media: stored, calls: 0, group: original },
    })
    const first = await importVideo(input(URL, 'Atlas demonstration', WORDS))
    const next = await importVideo(second)
    const after = await readFile(group, 'utf8')
    const again = await importVideo(second)
    const firstDoc = Document.fromMarkdown(await readFile(first.filePath!, 'utf8'))
    const secondDoc = Document.fromMarkdown(await readFile(next.filePath!, 'utf8'))
    assert({
      given: 'two recordings in one legacy note, including a different stored file for the second clip',
      should:
        'create independent complete entries, reuse the correct bytes, preserve the index and retry without changes',
      actual: {
        distinct: first.filePath !== next.filePath,
        calls,
        first: videoContent(firstDoc.markdown).transcriptText,
        second: videoContent(secondDoc.markdown).transcriptText,
        groupPrefix: after.startsWith(original),
        groupMetadata: Document.fromMarkdown(after).yaml,
        links: after.split('- Imported recording:').length - 1,
        unchanged: (await readFile(group, 'utf8')) === after,
        action: again.plan.action,
        videoFiles: (await readdir(mediaDir)).filter((name) => name.endsWith('.mp4')).length,
        secondAttachment: secondDoc.attachments.some((a) => a.file === 'second.mp4'),
        originalVideo: await readFile(stored, 'utf8'),
      },
      expected: {
        distinct: true,
        calls: 2,
        first: WORDS,
        second: 'The Widget recording contains its own complete transcript.',
        groupPrefix: true,
        groupMetadata: metadata,
        links: 2,
        unchanged: true,
        action: 'skip',
        videoFiles: 2,
        secondAttachment: true,
        originalVideo: 'stored second recording',
      },
    })
  })
})

test('interrupted collection filing repairs its index link without duplicate entries or model work', async () => {
  await fixture(async (options) => {
    const group = path.join(options.config.DIR_BASE, 'collection.md')
    await writeFile(
      group,
      new Document(
        { video: { url: [URL, `https://www.loom.com/share/${'1'.repeat(32)}`] } },
        '# Atlas collection\n',
      ).toMarkdown(),
    )
    const day = path.join(options.config.DIR_TIME, dayFile(WHEN.plainDate))
    await mkdir(day, { recursive: true })
    let calls = 0
    const input = {
      ...options,
      prepare: async () => {
        calls++
        return { body: WRITEUP, cleanedText: WORDS }
      },
    }
    let interrupted = false
    try {
      await importVideo(input)
    } catch {
      interrupted = true
    }
    await rm(day, { recursive: true })
    const result = await importVideo(input)
    const index = await readFile(group, 'utf8')
    await importVideo(input)
    assert({
      given: 'a failure after publishing a collection clip but before linking it',
      should: 'repair both links once from the checkpoint and then remain unchanged',
      actual: {
        interrupted,
        calls,
        links: index.split(path.basename(result.filePath!)).length - 1,
        unchanged: (await readFile(group, 'utf8')) === index,
        action: (await planVideoImport(options)).action,
      },
      expected: { interrupted: true, calls: 1, links: 1, unchanged: true, action: 'skip' },
    })
  })
})
