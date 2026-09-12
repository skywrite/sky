import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { runCommand } from '#lib/sys/mod.ts'
import { assert, test } from '#test'

test('Slack capture commands classify speech before allocating titles and preserve explicit metadata', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'slack-metadata-command-'))
  try {
    // A child isolates module mocks, config, recognition checkpoints and notebook writes.
    const result = await runCommand(
      'bun',
      [
        '--eval',
        `
      import { strict as check } from 'node:assert'
      import { mkdir, readFile, writeFile } from 'node:fs/promises'
      import * as path from 'node:path'
      import { mock } from 'bun:test'
      import { DIR_BASE, DIR_TIME, DIR_USER_DATA } from '#config'
      import MessageDocument from '#shared/models/Message/mod.ts'
      import { parseSlackConversation } from '#shared/models/Message/slack/parse.ts'
      import { pendingSlackAttachment } from '#shared/models/Message/slack/write.ts'
      import Follow from '#shared/models/Follow/mod.ts'
      import dayFile from '#shared/nbfs/dayFile.ts'
      import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
      const words = ['Atlas release accountability.', 'Widget handoff review.']
      const summary = 'Atlas release accountability and Widget handoff'
      const classified = { summaries: [], tags: [], rel: [] }
      let recognitions = 0
      const includesSpeech = (body) => { for (const word of words) check.ok(body.includes(word), body) }
      mock.module('#lib/notebook/enrich/summarize.ts', () => ({
        cleanSummary: (text) => text,
        summarizeTranscript: async (body) => { includesSpeech(body); classified.summaries.push(body); return summary },
      }))
      mock.module('#lib/notebook/enrich/autoTag.ts', () => ({
        autoTagMessage: async (input) => { includesSpeech(input.body); classified.tags.push(input); return 'Work/Planning' },
      }))
      mock.module('#lib/notebook/enrich/autoRel.ts', () => ({
        autoRelMessage: async (input) => { includesSpeech(input.body); classified.rel.push(input); return ['projects/Atlas'] },
      }))
      mock.module('#commands/all/audio/transcript/lib/glossary.ts', () => ({
        loadGlossary: async () => undefined, glossaryKeywords: () => [],
      }))
      mock.module('#commands/all/audio/transcript/lib/transcribe.ts', () => ({
        transcribeWithOpenAI: async () => { recognitions++; return { text: words[1] } },
      }))
      const { default: NewTask } = await import('#commands/all/slack/new.ts')
      const { default: FollowTask } = await import('#commands/all/slack/follow/message/mod.ts')
      const { default: MergeTask } = await import('#commands/all/slack/follow/message/merge.ts')
      const { default: SplitTask } = await import('#commands/all/slack/follow/message/split.ts')
      const context = { output: { log() {} } }
      const when = new PlainDateTime('2026-04-10 09:00')
      for (const label of ['2026-04-10 09:00', '2026-04-11 10:00']) {
        const day = new PlainDateTime(label).plainDate
        const file = path.join(DIR_TIME, dayFile(day))
        await mkdir(path.dirname(file), { recursive: true })
        await writeFile(file, '# ' + day + '\\n\\n')
      }
      await mkdir(DIR_USER_DATA, { recursive: true })
      const exports = new Map()
      let sequence = 0
      const makeExport = async () => {
        const key = ++sequence
        const channelId = 'C0MOCK' + key
        const ts = '177000000' + key + '.000001'
        const link = 'https://atlas.slack.com/archives/' + channelId + '/p' + ts.replace('.', '')
        const nativeFile = path.join(DIR_USER_DATA, 'native-' + key + '.m4a')
        const recognizedFile = path.join(DIR_USER_DATA, 'recognized-' + key + '.m4a')
        await writeFile(nativeFile, 'native recording ' + key)
        await writeFile(recognizedFile, 'recognition recording ' + key)
        const data = {
          link, channelId, channelName: 'atlas-' + key, conversationType: 'channel', messageTs: ts, threadTs: ts,
          message: { ts, timeLabel: when.toString(), userName: 'Jane Doe', text: 'One quick question.', permalink: link,
            files: [{ id: 'F0NATIVE' + key, path: nativeFile, name: 'native.m4a', voiceMemo: { workspaceUrl: 'https://atlas.slack.com', transcript: words[0] } }] },
          thread: { replies: [{ ts: '177009000' + key + '.000002', timeLabel: '2026-04-11 10:00', userName: 'John Smith', text: '',
            files: [{ id: 'F0RECOGNIZED' + key, path: recognizedFile, name: 'reply.m4a', voiceMemo: { workspaceUrl: 'https://atlas.slack.com' } }] }] },
        }
        exports.set(link, data)
        return data
      }
      const tasks = { run: async (name, args) => {
        if (name === 'slack:cli:export') return { ok: true, data: exports.get(args.link) }
        check.equal(name, 'slack:new')
        return new NewTask().run({ args, rawArgs: { when: args.when.toString() }, context, tasks })
      } }
      for (const mode of ['direct', 'explicit', 'follow', 'smart', 'archive', 'merge']) {
        const data = await makeExport()
        if (mode === 'smart') data.thread.replies[0].files.push(
          { id: 'F0DECK', name: 'Atlas slides', mode: 'external', externalUrl: 'https://example.com/slides/atlas', error: 'Downloaded HTML instead of file' },
          { id: 'F0REPORT', name: 'report.pdf', error: 'Download failed' },
        )
        const before = { summaries: classified.summaries.length, tags: classified.tags.length, rel: classified.rel.length, recognitions }
        let result
        let paths
        let title = summary
        if (mode === 'direct' || mode === 'explicit') {
          const args = { fromLink: data.link, when, noEditor: true,
            ...(mode === 'explicit' ? { summary: 'Curated topic', tags: 'Work/Curated', rel: 'projects/Widget-V2' } : {}) }
          if (mode === 'explicit') title = args.summary
          result = await new NewTask().run({ args, rawArgs: { when: when.toString() }, context, tasks })
          check.equal(result.ok, true, result.message)
          paths = [path.join(path.dirname(path.join(DIR_TIME, dayFile(when.plainDate))), result.data.filePath)]
        } else if (mode === 'merge') {
          const other = await makeExport()
          result = await new MergeTask().run({ args: { link1: data.link, link2: other.link, noEditor: true }, context, tasks })
          check.equal(result.ok, true, result.message)
          paths = result.data.slackFiles.map(file => path.join(DIR_BASE, file))
          const split = await new SplitTask().run({ args: { link: other.link }, context, tasks })
          check.equal(split.ok, true, split.message)
          check.equal(Follow.fromYaml(await readFile(split.data.file, 'utf8')).summary, summary)
        } else {
          result = await new FollowTask().run({
            args: { link: data.link, when, interval: '10m', noEditor: true, force: mode !== 'archive' },
            rawArgs: mode === 'follow' ? { when: when.toString() } : {}, context, tasks,
          })
          check.equal(result.ok, true, result.message)
          paths = result.data.slackFiles.map(file => path.join(DIR_BASE, file))
          const follow = Follow.fromYaml(await readFile(result.data.file, 'utf8'))
          check.equal(follow.summary, title)
          check.equal(follow.messages.length, mode === 'smart' ? 2 : 1)
        }
        const docs = await Promise.all(paths.map(async file => MessageDocument.fromMarkdown(await readFile(file, 'utf8'))))
        for (const doc of docs) {
          check.equal(doc.summary, title)
          check.ok(doc.markdown.startsWith('# ' + title + '\\n'), doc.markdown)
          check.equal(doc.yaml.tags, mode === 'explicit' ? 'Work/Curated' : 'Work/Planning')
          check.deepEqual(doc.yaml.rel, mode === 'explicit' ? 'projects/Widget-V2' : ['projects/Atlas'])
        }
        for (const word of words) check.ok(docs.some(doc => doc.markdown.includes(word)))
        if (mode === 'smart') {
          const attachments = parseSlackConversation(docs[1].markdown).attachments
          check.equal(attachments.length, 3)
          check.ok(attachments.find(a => a.id === 'attachment-slack-F0DECK').body.includes('https://example.com/slides/atlas'))
          check.ok(pendingSlackAttachment(attachments.find(a => a.id === 'attachment-slack-F0REPORT')))
          check.equal(docs[1].attachments.length, 1)
        }
        check.equal(recognitions - before.recognitions, mode === 'merge' ? 3 : 1)
        check.equal(classified.tags.length - before.tags, mode === 'explicit' ? 0 : 1)
        check.equal(classified.rel.length - before.rel, mode === 'explicit' ? 0 : 1)
        check.equal(classified.summaries.length - before.summaries, mode === 'explicit' ? 0 : mode === 'merge' ? 2 : 1)
        if (mode === 'direct') {
          const file = paths[0]
          const doc = docs[0]
          const edited = new MessageDocument({ ...doc.yaml, summary: 'My title', tags: 'Work/Edited' }, doc.markdown.replace(words[1], 'My corrected transcript.'))
          await writeFile(file, edited.toMarkdown())
          const repeated = await new NewTask().run({ args: { fromLink: data.link, when, noEditor: true }, rawArgs: { when: when.toString() }, context, tasks })
          check.equal(repeated.ok, true, repeated.message)
          check.equal(await readFile(file, 'utf8'), edited.toMarkdown())
          check.equal(recognitions - before.recognitions, 1)
        }
      }
    `,
      ],
      { env: { SKY_DIR: path.join(temp, 'notebook'), SKY_DATA_DIR: path.join(temp, 'user-data') } },
    )
    assert({
      given: 'real capture command paths with mocked recognition and metadata models',
      should: 'classify both native and recognized speech before saving, reuse speech, and preserve curated fields',
      actual: result.success || result.stderr || result.stdout,
      expected: true,
    })
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})
