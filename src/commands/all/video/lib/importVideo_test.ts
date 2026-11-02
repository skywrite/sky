import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
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
        originalVideo: await readFile(options.videoFile!, 'utf8'),
        originalTranscript: await readFile(options.transcriptFile!, 'utf8'),
        readable: first.filePath!.endsWith('2031-04-05_093045_Atlas-API-demonstration.md'),
      },
      expected: {
        same: true,
        action: 'skip',
        calls: 1,
        body: { summary: true, transcript: true, transcriptText: WORDS },
        url: URL,
        originalVideo: 'synthetic recording bytes',
        originalTranscript: WORDS,
        readable: true,
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
      },
      expected: { supplied: WORDS, transcriptCount: 1, summary: true },
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
    should: 'detect missing content and append substantive sections once',
    actual: {
      before: videoContent(body),
      after: videoContent(filled),
      prefix: filled.startsWith(body),
      stable: completeVideoBody(filled, { body: WRITEUP, cleanedText: WORDS }) === filled,
    },
    expected: {
      before: { summary: false, transcript: false, transcriptText: '' },
      after: { summary: true, transcript: true, transcriptText: WORDS },
      prefix: true,
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
