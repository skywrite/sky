import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import JournalDocument from '#shared/models/Journal/document/mod.ts'
import { dayDir } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { verifiedSources } from './ai.ts'
import { journalExcerpts } from './context.ts'
import { answerVersion, newReflectionMarkdown, readAnswers, writeAnswer } from './document.ts'
import { journalStaples } from './staples.ts'
import { journalStore } from './store.ts'
import type { JournalAI, JournalPaths, Reflection, ReflectionQuestion } from './types.ts'
import { runJournalJob } from './worker.ts'

const DAY = '2025-03-18'
const staples = [
  { title: 'Health', questions: ['How is your energy?', 'What helped you rest?'] },
  { title: 'Mood', questions: ['How do you feel?'] },
]
async function fixture(run: (store: ReturnType<typeof journalStore>, paths: JournalPaths) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-journal-test-'))
  const paths = { notebookDir: root, timeDir: path.join(root, 'time'), stateDir: path.join(root, '.private') }
  try {
    const store = journalStore(paths, DAY)
    await store.start('18:30', staples)
    await run(store, paths)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
const messageOf = async (run: () => Promise<unknown>) => {
  try {
    await run()
    return ''
  } catch (error) {
    return error instanceof Error ? error.message : 'failed'
  }
}

test('journal start and unanswered prompts create no notebook files', async () => {
  await fixture(async (store, paths) => {
    await store.write('health', 'q1', '\n ', 0)
    const repeat = await store.start('19:00', staples)
    assert({
      given: 'a session, an empty answer and a repeated start',
      should: 'reuse its questions without creating a journal directory',
      actual: { id: repeat.id, files: await readdir(paths.timeDir).catch(() => []) },
      expected: { id: (await store.requireSession()).id, files: [] },
    })
  })
})

test('Markdown answers round-trip headings, whitespace, other answers and raw notes', () => {
  const first: ReflectionQuestion = { id: 'q1', text: 'What changed?', origin: 'regular' }
  const second: ReflectionQuestion = { id: 'q2', text: 'What changed?', origin: 'followup' }
  const answers = [
    'One paragraph.',
    'Two paragraphs.\n\n## A heading of my own\n\nAn answer.\n',
    '- a\n- b\n\n',
    'A code example.\n\n```md\n## What changed?\n```\n',
  ]
  for (const answer of answers) {
    const topic: Reflection = {
      id: 'test',
      title: 'Test',
      staple: false,
      observation: '',
      sources: [],
      questions: [first, second],
      sections: ['q1'],
    }
    let document = writeAnswer('# Notes\n\nA raw note.\n\n', topic, first, answer)
    topic.sections!.push('q2')
    document = writeAnswer(document, topic, second, 'Another thought.\n')
    assert({
      given: 'a multiline answer and two identical question titles',
      should: 'use private publication order and preserve the answers without adding comments',
      actual: [readAnswers(document, topic), document.includes('A raw note.'), document.includes('<!--')],
      expected: [{ q1: answer, q2: 'Another thought.\n' }, true, false],
    })
  }
})

test('concurrent writes serialize first-file allocation and preserve different answers', async () => {
  await fixture(async (store, paths) => {
    await Promise.all([store.write('health', 'q1', 'Rested.\n', 0), store.write('health', 'q2', 'A quiet evening.', 0)])
    const topic = (await store.requireSession()).topics[0]
    const files = await readdir(path.dirname(path.join(paths.notebookDir, topic.file!)))
    await store.write('health', 'q1', 'Rested.\n', 0)
    assert({
      given: 'two answers saved concurrently and a lost-response retry',
      should: 'create one readable file and keep both answers',
      actual: {
        files: files.length,
        extension: topic.file?.endsWith('/Health.md'),
        answers: (await store.view()).answers.health,
      },
      expected: { files: 1, extension: true, answers: { q1: 'Rested.\n', q2: 'A quiet evening.' } },
    })
  })
})

test('external edits conflict before replacement and changed headings cannot silently create a second answer', async () => {
  await fixture(async (store, paths) => {
    await store.write('health', 'q1', 'Original answer.', 0)
    const topic = (await store.requireSession()).topics[0]
    const file = path.join(paths.notebookDir, topic.file!)
    await writeFile(file, (await readFile(file, 'utf8')).replace('Original answer.', 'A raw-file edit.'))
    const conflict = await messageOf(() =>
      store.write('health', 'q1', 'An older browser draft.', answerVersion('Original answer.')),
    )
    assert({
      given: 'a file edited outside the session',
      should: 'reject the stale save and preserve the raw edit',
      actual: [conflict.includes('changed elsewhere'), (await store.answer('health', 'q1')).content],
      expected: [true, 'A raw-file edit.'],
    })
    await store.write('health', 'q1', 'Deliberately replace it.', 0, true)
    await writeFile(file, (await readFile(file, 'utf8')).replace('## How is your energy?', '## A revised question?'))
    const removed = await messageOf(() => store.write('health', 'q1', 'Would append.', 0, true))
    assert({
      given: 'a published question whose heading changed',
      should: 'leave the file untouched and explain the conflict',
      actual: [removed.includes('heading changed'), (await readFile(file, 'utf8')).includes('Would append.')],
      expected: [true, false],
    })
  })
})

test('an ambiguous first-save recovery preserves the existing file without duplicating or overwriting it', async () => {
  await fixture(async (store, paths) => {
    const session = await store.requireSession()
    const topic = session.topics[0]
    const file = path.join('time', dayDir(new PlainDate(DAY)), 'journal/Health.md')
    topic.sections = ['q1']
    const content = writeAnswer(newReflectionMarkdown(session, topic), topic, topic.questions[0], 'Original draft.')
    topic.allocation = { file, content }
    await store.save(session)
    await mkdir(path.dirname(path.join(paths.notebookDir, file)), { recursive: true })
    await writeFile(path.join(paths.notebookDir, file), content.replace('Original draft.', 'Edited after the save.'))
    const error = await messageOf(() => store.write('health', 'q1', 'Original draft.', 0))
    assert({
      given: 'a service that died between file publication and recording its path',
      should: 'explain the ambiguity without duplicating or overwriting the file',
      actual: {
        conflict: error.includes('reserved file changed'),
        file: (await store.requireSession()).topics[0].file,
        files: (await readdir(path.dirname(path.join(paths.notebookDir, file)))).length,
      },
      expected: { conflict: true, file: undefined, files: 1 },
    })
  })
})

test('journal writes reject symlink paths', async () => {
  await fixture(async (store, paths) => {
    const journal = path.join(paths.timeDir, dayDir(new PlainDate(DAY)), 'journal')
    const other = path.join(paths.notebookDir, 'other')
    await mkdir(other)
    await mkdir(path.dirname(journal), { recursive: true })
    await symlink(other, journal)
    const error = await messageOf(() => store.write('health', 'q1', 'My answer.', 0))
    assert({
      given: 'a journal directory redirected through a symlink',
      should: 'refuse the write',
      actual: [error.includes('symbolic link'), await readdir(other)],
      expected: [true, []],
    })
  })
})

test('finishing an earlier browser journal removes bookkeeping and names it from writing without changing answers', async () => {
  await fixture(async (store, paths) => {
    const session = await store.requireSession()
    const topic = session.topics[0]
    topic.file = path.join('time', dayDir(new PlainDate(DAY)), 'journal/2025-03-18_183000_Health.md')
    delete topic.sections
    topic.questions.forEach((question) => {
      question.published = true
    })
    const answers = { q1: 'A restful evening.\n\n## My own heading\n\nA quiet walk.\n', q2: 'Less screen time.\n\n' }
    const legacy = `${newReflectionMarkdown(session, topic)}<!-- sky-journal-reflection:${session.id}/${topic.id} -->\n\n${topic.questions.map((question) => `<!-- sky-journal:${question.id} -->\n## ${question.text}\n\n${answers[question.id as keyof typeof answers]}\n<!-- /sky-journal:${question.id} -->\n`).join('\n')}`
    const file = path.join(paths.notebookDir, topic.file)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, legacy)
    await store.save(session)
    const before = await store.view()
    const name: JournalAI['name'] = async (_topic, actualAnswers) => {
      assert({
        given: 'an existing journal',
        should: 'name only the actual answers',
        actual: actualAnswers,
        expected: answers,
      })
      return { journalType: 'Health', summary: 'Restful Evening And A Quiet Walk' }
    }
    await store.finish('health', { name })
    const view = await store.view()
    const saved = view.session!.topics[0]
    const content = await readFile(path.join(paths.notebookDir, saved.file!), 'utf8')
    assert({
      given: 'a timestamped journal with internal comments and multiple answers',
      should: 'migrate to the audio/video naming convention, preserve writing exactly, and keep one clean file',
      actual: [
        before.answers.health,
        view.answers.health,
        path.basename(saved.file!),
        content.includes('<!--'),
        content.includes('summary: Restful Evening And A Quiet Walk'),
        (await readdir(path.dirname(file))).length,
      ],
      expected: [answers, answers, 'Health_Restful-Evening-And-A-Quiet-Walk.md', false, true, 1],
    })
    await store.write('health', 'q2', 'An updated answer.', answerVersion(answers.q2))
    await store.finish('health', {
      name: async () => {
        throw new Error('A named journal should keep its path')
      },
    })
    assert({
      given: 'more writing after naming',
      should: 'save through the stable question API without renaming again',
      actual: (await store.requireSession()).topics[0].file,
      expected: saved.file,
    })
  })
})

test('journal naming preserves collisions, falls back when AI fails, and detects writing changed during naming', async () => {
  await fixture(async (store, paths) => {
    await store.write('health', 'q1', 'A quiet walk helped me rest.', 0)
    const original = (await store.requireSession()).topics[0]
    const directory = path.dirname(path.join(paths.notebookDir, original.file!))
    const collision = path.join(directory, 'Health_Quiet-Evening.md')
    await writeFile(collision, '# Another journal\n\nKeep this writing.\n')
    await store.finish('health', { name: async () => ({ journalType: 'Health', summary: 'Quiet Evening' }) })
    const named = (await store.requireSession()).topics[0]
    const conflict = await messageOf(() =>
      store.finish(
        'health',
        {
          name: async () => {
            await store.write('health', 'q1', 'A newer answer.', answerVersion('A quiet walk helped me rest.'))
            return { journalType: 'Health', summary: 'Obsolete Summary' }
          },
        },
        true,
      ),
    )
    await store.write('mood', 'q1', 'Calm After A Walk', 0)
    await store.finish('mood', {
      name: async () => {
        throw new Error('Model unavailable')
      },
    })
    const view = await store.view()
    assert({
      given: 'a filename collision, concurrent writing and a naming outage',
      should: 'allocate a suffix, reject the stale name, and save a descriptive fallback without losing writing',
      actual: [
        path.basename(named.file!),
        await readFile(collision, 'utf8'),
        conflict.includes('changed while'),
        view.answers.health.q1,
        path.basename(view.session!.topics[1].file!),
        view.problems,
      ],
      expected: [
        'Health_Quiet-Evening-2.md',
        '# Another journal\n\nKeep this writing.\n',
        true,
        'A newer answer.',
        'Mood_Calm-After-A-Walk.md',
        {},
      ],
    })
  })
})

test('interrupted journal renames resume from private state without duplicating files', async () => {
  await fixture(async (store, paths) => {
    await store.write('health', 'q1', 'A quiet walk.', 0)
    const session = await store.requireSession()
    const topic = session.topics[0]
    const original = await readFile(path.join(paths.notebookDir, topic.file!), 'utf8')
    const to = path.join(path.dirname(topic.file!), 'Health_Quiet-Walk.md')
    topic.rename = { from: topic.file!, to, original, content: original, summary: 'Quiet Walk', journalType: 'Health' }
    await store.save(session)
    await writeFile(path.join(paths.notebookDir, to), original)
    await store.finish('health')
    const recovered = (await store.requireSession()).topics[0]
    assert({
      given: 'a crash after publishing the new name',
      should: 'finish the same rename and keep answers readable',
      actual: [
        recovered.file,
        recovered.rename,
        (await store.answer('health', 'q1')).content,
        (await readdir(path.join(paths.notebookDir, path.dirname(to)))).length,
      ],
      expected: [to, undefined, 'A quiet walk.', 1],
    })
  })
})

test('enrichment merges with current frontmatter and repeats only when the writing changes', async () => {
  await fixture(async (store, paths) => {
    const answer = 'A walk with Jane Doe helped me think about Atlas.\n\n## A small reset\n\nI felt rested.\n'
    await store.write('health', 'q1', answer, 0)
    await store.finish('health', { name: async () => ({ journalType: 'Health', summary: 'A Small Reset' }) })
    const original = (await store.requireSession()).topics[0]
    const file = path.join(paths.notebookDir, original.file!)
    await writeFile(
      file,
      (await readFile(file, 'utf8')).replace(
        'tags: Journal/Health\n',
        'tags: Journal/Health; Personal/Rest; Journal/Gratitude\nrel:\n  - Jane Doe\ncustom: keep-me\n',
      ),
    )
    const before = JournalDocument.fromMarkdown(await readFile(file, 'utf8'))
    const inputs: Array<Parameters<NonNullable<JournalAI['enrich']>>[0]> = []
    const ai: Pick<JournalAI, 'enrich'> = {
      enrich: async (input) => {
        inputs.push(input)
        // A raw metadata edit made while the model runs must survive its result.
        await writeFile(
          file,
          (await readFile(file, 'utf8')).replace('custom: keep-me', 'custom: edited-during-enrichment'),
        )
        return { tags: 'Personal/Rest; Health/Walking', rel: ['jane doe', 'projects/Atlas'] }
      },
    }
    await store.finish('health', ai)
    const enriched = JournalDocument.fromMarkdown(await readFile(file, 'utf8'))
    assert({
      given: 'an already named journal with manually chosen tags and links',
      should: 'enrich only the writing, merge deduplicated metadata, and preserve the body and filename',
      actual: {
        inputs,
        tags: [...enriched.tags],
        rel: [...enriched.rel],
        custom: enriched.yaml.custom,
        body: enriched.markdown,
        file: (await store.requireSession()).topics[0].file,
      },
      expected: {
        inputs: [{ summary: 'A Small Reset', body: answer, existingRel: ['Jane Doe'] }],
        tags: ['Journal/Health', 'Personal/Rest', 'Journal/Gratitude', 'Health/Walking'],
        rel: ['Jane Doe', 'projects/Atlas'],
        custom: 'edited-during-enrichment',
        body: before.markdown,
        file: original.file,
      },
    })
    await writeFile(file, (await readFile(file, 'utf8')).replace('; Health/Walking', ''))
    await store.finish('health', ai)
    assert({
      given: 'the owner removing an automatic tag without changing their writing',
      should: 'retain that choice and avoid another model call',
      actual: [inputs.length, (await readFile(file, 'utf8')).includes('Health/Walking')],
      expected: [1, false],
    })
    const newer = 'I discussed the Atlas experiment with Jane Doe.\n'
    await store.write('health', 'q1', newer, answerVersion(answer))
    await store.finish('health', ai)
    assert({
      given: 'new writing in a previously enriched journal',
      should: 'refresh enrichment while keeping the existing filename and answer',
      actual: [
        inputs.length,
        inputs.at(-1)?.body,
        (await store.requireSession()).topics[0].file,
        (await store.answer('health', 'q1')).content,
      ],
      expected: [2, newer, original.file, newer],
    })
    await store.finish(
      'health',
      { name: async () => ({ journalType: 'Health', summary: 'A Useful Conversation' }) },
      true,
    )
    const renamed = (await store.requireSession()).topics[0]
    const renamedDoc = JournalDocument.fromMarkdown(await readFile(path.join(paths.notebookDir, renamed.file!), 'utf8'))
    assert({
      given: 'an explicit summary rename after enrichment',
      should: 'keep the journal type, additional tags, and links',
      actual: { tags: [...renamedDoc.tags].sort(), rel: [...renamedDoc.rel] },
      expected: {
        tags: ['Journal/Health', 'Personal/Rest', 'Journal/Gratitude', 'Health/Walking'].sort(),
        rel: ['Jane Doe', 'projects/Atlas'],
      },
    })
  })
})

test('a failed enrichment does not block naming or saving and can be retried', async () => {
  await fixture(async (store, paths) => {
    await store.write('mood', 'q1', 'A quiet evening.', 0)
    let attempts = 0
    const ai: Pick<JournalAI, 'name' | 'enrich'> = {
      name: async () => ({ journalType: 'Mood', summary: 'A Quiet Evening' }),
      enrich: async () => {
        if (++attempts === 1) throw new Error('Model unavailable')
        return { tags: 'Personal/Rest', rel: ['Jane Doe'] }
      },
    }
    await store.finish('mood', ai)
    const first = (await store.requireSession()).topics[1]
    await store.finish('mood', ai)
    const topic = (await store.requireSession()).topics[1]
    const doc = JournalDocument.fromMarkdown(await readFile(path.join(paths.notebookDir, topic.file!), 'utf8'))
    assert({
      given: 'enrichment unavailable on the first attempt',
      should: 'save and name normally, then enrich the same file when retried',
      actual: [
        first.summary,
        first.enriched,
        topic.file === first.file,
        Boolean(topic.enriched),
        attempts,
        [...doc.tags],
        [...doc.rel],
        (await store.answer('mood', 'q1')).content,
      ],
      expected: [
        'A Quiet Evening',
        undefined,
        true,
        true,
        2,
        ['Journal/Mood', 'Personal/Rest'],
        ['Jane Doe'],
        'A quiet evening.',
      ],
    })
  })
})

test('enrichment generated for old writing is not applied to a newer answer', async () => {
  await fixture(async (store, paths) => {
    await store.write('health', 'q1', 'An earlier answer.', 0)
    const error = await messageOf(() =>
      store.finish('health', {
        enrich: async () => {
          await store.write('health', 'q1', 'A newer answer.', answerVersion('An earlier answer.'))
          return { tags: 'Health/Obsolete', rel: ['projects/Atlas'] }
        },
      }),
    )
    const topic = (await store.requireSession()).topics[0]
    const doc = JournalDocument.fromMarkdown(await readFile(path.join(paths.notebookDir, topic.file!), 'utf8'))
    assert({
      given: 'an answer edited while enrichment is running',
      should: 'preserve the newer writing and leave the obsolete metadata unapplied',
      actual: [
        error.includes('changed while'),
        topic.enriched,
        [...doc.tags],
        [...doc.rel],
        (await store.answer('health', 'q1')).content,
      ],
      expected: [true, undefined, ['Journal/Health'], [], 'A newer answer.'],
    })
  })
})

test('regular Health and Mood templates survive curation and use defaults on a new notebook', async () => {
  await fixture(async (_store, paths) => {
    const dir = path.join(paths.notebookDir, 'journal/questions')
    await mkdir(dir, { recursive: true })
    await writeFile(
      path.join(dir, 'Health.md'),
      '## EVERY-DAY\n- 1.0: How did you sleep?\n  - 1.0: What helped?\n- 1.0: How is your energy?\n',
    )
    const regular = await journalStaples(paths.notebookDir, DAY)
    assert({
      given: 'custom regular questions and no Mood template',
      should: 'retain all daily questions and offer a usable Mood check-in',
      actual: [regular[0].questions, regular[1].questions.length],
      expected: [['How did you sleep?', 'What helped?', 'How is your energy?'], 1],
    })
  })
})

test('follow-ups use saved answers, keep staples, and leave stale generations unapplied', async () => {
  await fixture(async (store, paths) => {
    const session = await store.requireSession()
    session.operation = { id: 'prepare-1', action: 'prepare', status: 'running', stage: '' }
    await store.save(session)
    const ai: JournalAI = {
      prepare: async () => [
        { title: 'Perspective', question: 'What changed your mind?', observation: '', sources: [] },
      ],
      followup: async () => ({ question: 'What would you keep?', covered: ['health', 'mood', 'perspective'] }),
    }
    await runJournalJob({ paths, day: DAY, request: 'prepare-1' }, ai)
    await store.write('health', 'q1', 'A walk helped me think.', 0)
    const prepared = await store.requireSession()
    prepared.operation = { id: 'deeper-1', action: 'deeper', topic: 'health', status: 'running', stage: '' }
    await store.save(prepared)
    await runJournalJob({ paths, day: DAY, request: 'deeper-1' }, ai)
    const done = await store.requireSession()
    assert({
      given: 'an AI follow-up reporting overlapping topics',
      should: 'append within the reflection and protect Health and Mood',
      actual: [done.topics[0].questions.at(-1)?.text, done.topics[1].coveredBy, done.topics[2].coveredBy],
      expected: ['What would you keep?', undefined, 'health'],
    })
    done.operation = { id: 'deeper-2', action: 'deeper', topic: 'health', status: 'running', stage: '' }
    await store.save(done)
    await runJournalJob(
      { paths, day: DAY, request: 'deeper-2' },
      {
        ...ai,
        followup: async () => {
          await store.write('health', 'q1', 'A different answer.', answerVersion('A walk helped me think.'))
          return { question: 'An obsolete follow-up?', covered: [] }
        },
      },
    )
    const stale = await store.requireSession()
    assert({
      given: 'writing that changes while the AI is thinking',
      should: 'preserve that writing and ask for a fresh follow-up',
      actual: [stale.operation?.status, stale.topics[0].questions.some((q) => q.text === 'An obsolete follow-up?')],
      expected: ['failed', false],
    })
  })
})

test('AI source cards discard invented quotes and document IDs', () => {
  assert({
    given: 'a correct quote and two unsupported citations',
    should: 'show only the exact verified passage',
    actual: verifiedSources(
      [
        { id: 0, quote: 'A small experiment.' },
        { id: 0, quote: 'An invented claim.' },
        { id: 9, quote: 'Missing.' },
      ],
      [{ path: 'notes/Atlas.md', title: 'Atlas', content: '# Atlas\n\nA small experiment.' }],
    ),
    expected: [{ path: 'notes/Atlas.md', title: 'Atlas', quote: 'A small experiment.' }],
  })
})

test('an untouched answer beside a saved answer stays unpublished', async () => {
  await fixture(async (store) => {
    await store.write('health', 'q1', 'Rested.', 0)
    await store.write('health', 'q2', '\n', 0)
    const view = await store.view()
    assert({
      given: 'an empty save to another question in the same reflection',
      should: 'keep that answer usable without publishing an empty section',
      actual: [view.problems, view.answers.health.q2],
      expected: [{}, ''],
    })
  })
})

test('journal model context remains bounded while preserving pinned and recent evidence', () => {
  const docs = Array.from({ length: 50 }, (_, i) => ({
    path: `notes/Sample-${i}.md`,
    title: `Sample ${i}`,
    content: `Opening ${i}.\n` + 'Synthetic context. '.repeat(2000) + `\nClosing ${i}.`,
  }))
  const selected = journalExcerpts(docs, 12000, 1000)
  assert({
    given: 'many large notebook documents',
    should: 'bound the model request, retain pinned and newest sources, and verify quotes against original text',
    actual: {
      bounded: selected.reduce((size, doc) => size + doc.excerpt.length, 0) <= 12000,
      pinned: selected.some((doc) => doc.path === docs[0].path),
      latest: selected.some((doc) => doc.path === docs.at(-1)!.path),
      oldest: selected.some((doc) => doc.path === docs[10].path),
      original: selected.every((doc) => doc.content === docs.find((original) => original.path === doc.path)!.content),
      tails: selected.every((doc) => doc.excerpt.includes('Closing')),
    },
    expected: { bounded: true, pinned: true, latest: true, oldest: false, original: true, tails: true },
  })
})

test('a question dismissed while Sky is thinking invalidates the pending follow-up', async () => {
  await fixture(async (store, paths) => {
    await store.write('health', 'q1', 'A restful evening.', 0)
    const session = await store.requireSession()
    session.operation = {
      id: 'dismiss-during-generation',
      action: 'deeper',
      topic: 'health',
      status: 'running',
      stage: '',
    }
    await store.save(session)
    await runJournalJob(
      { paths, day: DAY, request: 'dismiss-during-generation' },
      {
        prepare: async () => [],
        followup: async () => {
          await store.lock(async () => {
            const current = await store.requireSession()
            current.topics[0].questions[0].dismissed = true
            await store.save(current)
          })
          return { question: 'An obsolete question?', covered: [] }
        },
      },
    )
    const view = await store.view()
    assert({
      given: 'a reflection changed by dismissal during generation',
      should: 'keep the question dismissed and leave its writing intact without appending the stale follow-up',
      actual: [
        view.session?.operation?.status,
        view.session?.topics[0].questions.length,
        view.session?.topics[0].questions[0].dismissed,
        view.answers.health.q1,
      ],
      expected: ['failed', 2, true, 'A restful evening.'],
    })
  })
})
