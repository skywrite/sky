import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import Document from '#shared/models/Markdown/Document/mod.ts'
import { assert, test } from '#test'
import { WritingVoice } from './agent.ts'
import { parseEditId } from './draftEdits.ts'
import { WritingDraftStore } from './drafts.ts'
import { WritingVoiceStore } from './store.ts'
import { failure, intelligence, SAMPLE, voiceFixture } from './testHelpers.ts'

test('Writing voice seeds the shared rules from existing Outbox preferences and preserves hand edits', async () => {
  const f = await voiceFixture()
  try {
    await mkdir(path.join(f.root, 'outbox'))
    await writeFile(path.join(f.root, 'outbox', 'preferences.md'), '---\ncustom: keep\n---\nUse short paragraphs.\n')
    await f.store.initialize()
    const rules = await f.store.rules()
    await f.store.saveRules('Use readable paragraphs.\n', rules.revision)
    const doc = Document.fromMarkdown(await readFile(path.join(f.store.dir, 'rules.md'), 'utf8'))
    assert({
      given: 'existing preferences and a manual rule edit',
      should: 'keep one shared guide and preserve metadata',
      actual: [rules.text.trim(), doc.markdown.trim(), doc.yaml.custom],
      expected: ['Use short paragraphs.', 'Use readable paragraphs.', 'keep'],
    })
    assert({
      given: 'a stale settings tab',
      should: 'refuse to overwrite the newer rules',
      actual: (await failure(f.store.saveRules('Old text', rules.revision))).includes('changed'),
      expected: true,
    })
  } finally {
    await f.dispose()
  }
})

test('An edit with no draft becomes one that keeps exact characters, survives reload, and is saved once', async () => {
  const f = await voiceFixture()
  try {
    const input = {
      ...SAMPLE,
      original: '## Draft\n\n“Ready”—yes…\n---\n  keep spaces  ',
      revised: '## Revision\n\n"Ready" - yes.\n  keep spaces  ',
    }
    const first = (await f.learning.capture(input))!.draft
    const again = (await f.learning.capture(input))!.draft
    const reopened = new WritingDraftStore(
      new WritingVoice(new WritingVoiceStore(f.root, f.store.stateDir), intelligence),
    )
    const saved = await reopened.require(first.id)
    assert({
      given: 'headings, punctuation, whitespace, and a repeated capture',
      should: 'preserve the exact pair once, as two versions of one draft',
      actual: [
        saved.versions.map((version) => [version.author, version.text]),
        saved.source,
        again.id,
        await f.drafts.ids(),
        (await f.learning.edits()).length,
      ],
      expected: [
        [
          ['sky', input.original],
          ['you', input.revised],
        ],
        SAMPLE.source,
        first.id,
        [first.id],
        1,
      ],
    })
    assert({
      given: 'unchanged text',
      should: 'save nothing to learn from',
      actual: [await f.learning.capture({ ...SAMPLE, revised: SAMPLE.original }), (await f.drafts.ids()).length],
      expected: [null, 1],
    })
  } finally {
    await f.dispose()
  }
})

test('Folding lessons in preserves existing rules and every confirmed lesson, and the drafts keep their history', async () => {
  const f = await voiceFixture()
  try {
    const asked = await f.edited()
    const learned = await f.learning.answer(asked.id, asked.revision, { option: 0 })
    await f.voice.idle()
    const unanswered = await f.edited({ ...SAMPLE, source: 'outbox:other' })
    const before = await f.store.rules()
    const result = await f.voice.compact()
    const rules = await f.store.rules()
    const resumed = new WritingDraftStore(
      new WritingVoice(new WritingVoiceStore(f.root, f.store.stateDir), intelligence),
    )
    const kept = (await resumed.require(parseEditId(learned.id).draftId)).versions[1]!
    assert({
      given: 'one learned edit and one unanswered question',
      should: 'retain existing rules, add the lesson, keep the unanswered edit open, and leave no receipt behind',
      actual: [
        result.compacted,
        rules.text.startsWith(before.text.trimEnd()),
        rules.text.includes(learned.lesson!.text),
        rules.folding,
        (await resumed.learning.edits()).map((entry) => entry.id),
        [kept.folded, kept.lesson, kept.answer],
      ],
      expected: [1, true, true, [], [unanswered.id], [true, learned.lesson, learned.answer]],
    })
    const file = await readFile(path.join(f.store.dir, 'drafts', `${parseEditId(learned.id).draftId}.md`), 'utf8')
    assert({
      given: 'the folded draft opened as a file',
      should: 'show the owner what Sky learned from that version and that the rules now hold it',
      actual: [
        file.includes(`What Sky learned: ${learned.lesson!.text}`),
        file.includes('Now part of your writing rules.'),
      ],
      expected: [true, true],
    })
    assert({
      given: 'the same change saved again after its lesson was folded in',
      should: 'return the draft it already has instead of teaching the lesson twice',
      actual: [(await resumed.learning.capture(SAMPLE))?.draft.id, (await resumed.ids()).length],
      expected: [parseEditId(learned.id).draftId, 2],
    })
  } finally {
    await f.dispose()
  }
})

test('Folding refuses invented coverage and concurrent rule changes without losing the lesson', async () => {
  const f = await voiceFixture()
  try {
    const asked = await f.edited()
    const learned = await f.learning.answer(asked.id, asked.revision, { text: 'Use a direct opening in emails.' })
    await f.voice.idle()
    const rules = await f.store.rules()
    const invalid = await failure(
      f.store.fold(rules, [learned], {
        lessons: [],
        covered: [{ examples: [learned.id], quote: 'An invented rule.' }],
      }),
    )
    await f.store.saveRules(`${rules.text}\nKeep my manual rule.\n`, rules.revision)
    const stale = await failure(
      f.store.fold(rules, [learned], { covered: [], lessons: [{ ...learned.lesson!, examples: [learned.id] }] }),
    )
    assert({
      given: 'fabricated coverage and an editor racing the fold-in',
      should: 'refuse both plans and preserve the lesson and the manual rule',
      actual: [
        invalid.includes('cited'),
        stale.includes('changed'),
        (await f.learning.get(learned.id)).lesson,
        (await f.store.rules()).text.includes('Keep my manual rule.'),
      ],
      expected: [true, true, learned.lesson, true],
    })
  } finally {
    await f.dispose()
  }
})

test('An interrupted fold-in finishes only for lessons the rules durably recorded', async () => {
  const f = await voiceFixture()
  try {
    const first = await f.edited(SAMPLE, 'State the point directly.')
    const other = await f.edited({ ...SAMPLE, source: 'chat:other' }, 'State the point directly.')
    const file = path.join(f.store.dir, 'rules.md')
    const doc = Document.fromMarkdown(await readFile(file, 'utf8'))
    await writeFile(
      file,
      new Document({ ...doc.yaml, folding: [first.id] }, `${doc.markdown}\nPreserved lesson.\n`).toMarkdown(),
    )
    const inputs: Parameters<typeof intelligence.draft>[0][] = []
    f.voice.intelligence.draft = async (input) => {
      inputs.push(input)
      return input.meaning
    }
    await f.voice.draft({ meaning: 'The draft is ready.', medium: 'Email' })
    await f.voice.compact(false)
    assert({
      given: 'a crash after the rules took a lesson and before its draft was marked',
      should: 'never read that lesson twice, then mark its draft, drop the receipt, and leave the other edit open',
      actual: [
        inputs[0]!.lessons.length,
        (await f.learning.edits()).map((edit) => edit.id),
        (await f.store.rules()).folding,
        (await f.store.rules()).text.includes('Preserved lesson.'),
      ],
      expected: [1, [other.id], [], true],
    })
  } finally {
    await f.dispose()
  }
})

test('Writing voice refuses traversals and symbolic links', async () => {
  const f = await voiceFixture()
  try {
    await mkdir(path.join(f.root, 'me'))
    await symlink(path.join(f.root, 'state'), path.join(f.root, 'me', 'voice'))
    assert({
      given: 'a traversal ID and a redirected voice directory',
      should: 'refuse access outside the canonical files',
      actual: [
        (await failure(f.learning.get('../rules:1'))).includes('Invalid'),
        (await failure(f.store.rules())).includes('symbolic'),
      ],
      expected: [true, true],
    })
  } finally {
    await f.dispose()
  }
})
