import { lstat, mkdir, readFile, unlink } from 'node:fs/promises'
import * as path from 'node:path'
import { readJson, withProcessLock, writeJson } from '#lib/jobs/files.ts'
import { createDayFile } from '#lib/nbfs/createDayFile.ts'
import { withMarkdownWrite } from '#lib/nbfs/withMarkdownWrite.ts'
import { atomicWrite, hash, missing, readOptional } from '#lib/outbox/files.ts'
import slugify from '#lib/string/slugify.ts'
import JournalDocument from '#shared/models/Journal/document/mod.ts'
import { dayDir } from '#shared/nbfs/mod.ts'
import { instantNow, PlainDate } from '#universal/dates/nbdt/mod.ts'
import {
  answerVersion,
  cleanReflectionMarkdown,
  enrichedReflectionMarkdown,
  journalType,
  namedReflectionMarkdown,
  newReflectionMarkdown,
  readAnswers,
  writeAnswer,
} from './document.ts'
import {
  JournalError,
  type JournalAI,
  type JournalEnrichment,
  type JournalPaths,
  type JournalSession,
  type JournalView,
  type Reflection,
} from './types.ts'

export function journalDayDir(paths: JournalPaths, day: string): string {
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || new PlainDate(day).ymd !== day) throw new Error('Invalid date')
  } catch {
    throw new JournalError('Choose a valid journal day.')
  }
  return path.join(paths.stateDir, hash(paths.notebookDir), day)
}

export function journalStore(paths: JournalPaths, day: string) {
  const state = path.join(journalDayDir(paths, day), 'session.json')
  const read = () => readJson<JournalSession>(state)
  const save = (session: JournalSession) => writeJson(state, session)
  const lock = <T>(run: () => Promise<T>) => withProcessLock(path.join(journalDayDir(paths, day), 'lock'), run)
  const requireSession = async () => {
    const session = await read()
    if (!session) throw new JournalError('Start a journal for this day first.', 404)
    return session
  }
  const topicOf = (session: JournalSession, id: string) => {
    const topic = session.topics.find((t) => t.id === id)
    if (!topic) throw new JournalError('This reflection is no longer in the session.', 404)
    return topic
  }

  // Reject symlinks before both new-file allocation and subsequent reads/writes.
  const safeFile = async (relative: string, creating = false) => {
    const directory = path.resolve(paths.timeDir, dayDir(new PlainDate(day)), 'journal')
    const full = path.resolve(paths.notebookDir, relative)
    if (path.dirname(full) !== directory || !full.endsWith('.md')) throw new JournalError('Invalid reflection file.')
    const rel = path.relative(paths.notebookDir, full)
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new JournalError('The journal is outside this notebook.')
    let cursor = paths.notebookDir
    for (const part of rel.split(path.sep)) {
      cursor = path.join(cursor, part)
      const info = await lstat(cursor).catch((error: unknown) => {
        if (creating && missing(error)) return null
        throw error
      })
      if (info?.isSymbolicLink()) throw new JournalError('The reflection path contains a symbolic link.', 409)
    }
    return full
  }
  const markdown = async (topic: Reflection) => {
    if (!topic.file) return ''
    try {
      return await readFile(await safeFile(topic.file), 'utf8')
    } catch (error) {
      if (missing(error))
        throw new JournalError(`“${topic.title}” was moved or removed. Its saved file is ${topic.file}.`, 409)
      throw error
    }
  }
  const snapshot = async (session: JournalSession | null): Promise<JournalView> => {
    const answers: JournalView['answers'] = {}
    const problems: JournalView['problems'] = {}
    if (session)
      for (const topic of session.topics) {
        try {
          const content = await markdown(topic)
          answers[topic.id] = topic.file
            ? readAnswers(content, topic)
            : Object.fromEntries(topic.questions.map((q) => [q.id, '']))
        } catch (error) {
          problems[topic.id] = error instanceof Error ? error.message : 'Could not read this reflection.'
        }
      }
    return { session, answers, problems, namingAvailable: true }
  }

  const completeRename = async (session: JournalSession, topic: Reflection) => {
    const pending = topic.rename
    if (!pending) return
    const source = await safeFile(pending.from, true)
    const target = await safeFile(pending.to, true)
    const original = await readOptional(source)
    if (original !== undefined && original !== pending.original)
      throw new JournalError(
        `“${topic.title}” changed while its filename was being updated. Both copies are preserved; review ${pending.from}.`,
        409,
      )
    const existing = await readOptional(target)
    if (existing === undefined) {
      if (!(await createDayFile(target, pending.content)))
        throw new JournalError('Another journal took this filename. Retry naming your reflection.', 409)
    } else if (topic.file !== pending.to && existing !== pending.content) {
      throw new JournalError(
        `The new journal filename is already in use: ${pending.to}. Your writing is preserved at ${pending.from}.`,
        409,
      )
    }
    topic.file = pending.to
    topic.summary = pending.summary
    topic.journalType = pending.journalType
    if (pending.enriched) topic.enriched = pending.enriched
    await save(session)
    if (original !== undefined) await unlink(source)
    delete topic.rename
    await save(session)
  }
  const recoverRename = async (session: JournalSession, topic: Reflection) => {
    if (!topic.rename) return
    const source = await safeFile(topic.rename.from, true)
    const file = (await readOptional(source)) === undefined ? await safeFile(topic.rename.to) : source
    await withMarkdownWrite(file, () => completeRename(session, topic))
  }

  return {
    paths,
    day,
    read,
    save,
    lock,
    requireSession,
    topicOf,
    snapshot,
    view: () => lock(async () => snapshot(await read())),
    async start(time: string, staples: Array<{ title: string; questions: string[] }>): Promise<JournalSession> {
      return lock(async () => {
        const existing = await read()
        if (existing) return existing
        const created = instantNow()
        const session: JournalSession = {
          id: `${created.slice(0, 10)}_${created.slice(11, 19).replaceAll(':', '')}_Journal`,
          day,
          created,
          time,
          current: 'health',
          prepared: false,
          completed: [],
          topics: staples.map(({ title, questions }) => ({
            id: slugify(title),
            title,
            journalType: title,
            sections: [],
            staple: true,
            observation: '',
            sources: [],
            questions: questions.map((text, i) => ({ id: `q${i + 1}`, text, origin: 'regular' })),
          })),
        }
        await save(session)
        return session
      })
    },
    async answer(topicId: string, questionId: string) {
      return lock(async () => {
        const session = await requireSession()
        const topic = topicOf(session, topicId)
        const question = topic.questions.find((q) => q.id === questionId)
        if (!question) throw new JournalError('This question is no longer in the reflection.', 404)
        const content = topic.file ? readAnswers(await markdown(topic), topic)[question.id] : ''
        return { content, version: answerVersion(content) }
      })
    },
    async write(topicId: string, questionId: string, content: string, version: number, force = false) {
      return lock(async () => {
        const session = await requireSession()
        const topic = topicOf(session, topicId)
        if (topic.rename) await recoverRename(session, topic)
        const question = topic.questions.find((q) => q.id === questionId)
        if (!question) throw new JournalError('This question is no longer in the reflection.', 404)
        if (!topic.file) {
          if (!content.trim()) return { content: '', version: 0 }
          if (version !== 0 && !force)
            throw new JournalError('This answer changed. Review the saved version before replacing it.', 409)
          topic.sections = [...new Set([...(topic.sections ?? []), question.id])]
          const initial = writeAnswer(newReflectionMarkdown(session, topic), topic, question, content)
          // The day directory supplies the date, as it does for audio/video journals.
          const base = slugify(journalType(topic), { preserveCase: true }) || 'Misc'
          for (let n = 1; n < 1000; n++) {
            const recovering = Boolean(topic.allocation)
            const file =
              topic.allocation?.file ??
              path.relative(
                paths.notebookDir,
                path.join(paths.timeDir, dayDir(new PlainDate(day)), 'journal', `${base}${n === 1 ? '' : `-${n}`}.md`),
              )
            const reserved = topic.allocation?.content ?? initial
            const full = await safeFile(file, true)
            await mkdir(path.dirname(full), { recursive: true })
            const existing = await readFile(full, 'utf8').catch((error: unknown) => {
              if (missing(error)) return null
              throw error
            })
            if (existing !== null && !recovering) continue
            if (recovering && existing !== null && existing !== reserved)
              throw new JournalError(
                `The first save’s reserved file changed: ${file}. Review it before continuing; no file was overwritten or duplicated.`,
                409,
              )
            topic.allocation = { file, content: reserved }
            await save(session)
            if (existing === reserved || (existing === null && (await createDayFile(full, reserved)))) {
              topic.file = file
              delete topic.allocation
              await save(session)
              break
            }
            delete topic.allocation
            await save(session)
          }
          if (!topic.file)
            throw new JournalError('Could not allocate a journal filename. Your answer is still in the browser.', 500)
        }
        const full = await safeFile(topic.file)
        return withMarkdownWrite(full, async () => {
          const old = await readFile(full, 'utf8')
          const clean = cleanReflectionMarkdown(old, topic)
          topic.sections = [...new Set([...clean.sections, question.id])]
          const current = readAnswers(old, topic)[question.id]
          if (!question.published && !current && !content.trim()) return { content: '', version: 0 }
          if (current === content) {
            if (clean.markdown !== old) await atomicWrite(full, clean.markdown)
            if (content || question.published) {
              question.published = true
              await save(session)
            }
            return { content, version: answerVersion(content) }
          }
          if (!force && answerVersion(current) !== version)
            throw new JournalError(
              `“${topic.title}” changed elsewhere. Review its saved answer before replacing it.`,
              409,
            )
          // Record the section's address before publication; an interrupted append can be recovered by its heading.
          await save(session)
          await atomicWrite(full, writeAnswer(old, topic, question, content))
          question.published = true
          await save(session)
          return { content, version: answerVersion(content) }
        })
      })
    },
    async finish(topicId: string, ai: Pick<JournalAI, 'name' | 'enrich'> = {}, rename = false) {
      let original = topicOf(await requireSession(), topicId)
      if (!original.file) return
      if (original.rename) {
        await lock(async () => {
          const session = await requireSession()
          await recoverRename(session, topicOf(session, topicId))
        })
        original = topicOf(await requireSession(), topicId)
      }
      const saved = await markdown(original)
      const answers = readAnswers(saved, original)
      const body = Object.values(answers)
        .filter((answer) => answer.trim())
        .join('\n\n')
      if (!body.trim()) return
      const fingerprint = hash(body)
      const needsEnrichment = Boolean(ai.enrich && original.enriched !== fingerprint)
      if (original.summary && !rename && !needsEnrichment) return
      const fallback = body
        .replace(/[#*_`>\[\]]/g, '')
        .trim()
        .split(/\s+/)
        .slice(0, 7)
        .join(' ')
      let named = { journalType: journalType(original), summary: original.summary || fallback || original.title }
      if (!original.summary || rename) {
        try {
          named = (await ai.name?.(original, answers)) ?? named
        } catch {
          // Naming is optional enrichment; a model outage must not block saving or leaving the journal.
        }
      }
      named.summary = named.summary.replace(/[\r\n]+/g, ' ').trim() || fallback || original.title
      named.journalType = named.journalType.replace(/[\r\n]+/g, ' ').trim() || journalType(original)
      let enrichment: JournalEnrichment | undefined
      if (needsEnrichment) {
        try {
          enrichment = await ai.enrich!({
            summary: named.summary,
            body,
            existingRel: [...JournalDocument.fromMarkdown(saved).rel],
          })
        } catch {
          // A failed enrichment leaves the writing saved and the fingerprint unset for a later retry.
        }
      }
      await lock(async () => {
        const session = await requireSession()
        const topic = topicOf(session, topicId)
        if (topic.rename) return recoverRename(session, topic)
        const full = await safeFile(topic.file!)
        await withMarkdownWrite(full, async () => {
          const old = await readFile(full, 'utf8')
          if (JSON.stringify(readAnswers(old, topic)) !== JSON.stringify(answers))
            throw new JournalError(
              `“${topic.title}” changed while Sky was finishing it. Your writing is saved; try again to use the latest answer.`,
              409,
            )
          const clean = cleanReflectionMarkdown(old, topic)
          topic.sections = clean.sections
          const needsName = !topic.summary || rename
          let content = needsName
            ? namedReflectionMarkdown(clean.markdown, named.journalType, named.summary)
            : clean.markdown
          if (enrichment) content = enrichedReflectionMarkdown(content, enrichment)
          const update = async () => {
            if (content !== old) await atomicWrite(full, content)
            if (needsName) {
              topic.summary = named.summary
              topic.journalType = named.journalType
            }
            if (enrichment) topic.enriched = fingerprint
            await save(session)
          }
          if (!needsName) return update()
          const typeSlug = slugify(named.journalType, { preserveCase: true }) || 'Misc'
          const summarySlug = slugify(named.summary, { preserveCase: true, suggestedLength: 70 }) || 'Reflection'
          const base = `${typeSlug}_${summarySlug}`
          for (let n = 1; n < 1000; n++) {
            const relative = path.join(path.dirname(topic.file!), `${base}${n === 1 ? '' : `-${n}`}.md`)
            const destination = await safeFile(relative, true)
            if (relative === topic.file) {
              return update()
            }
            if ((await readOptional(destination)) !== undefined) continue
            topic.rename = {
              from: topic.file!,
              to: relative,
              original: old,
              content,
              ...named,
              ...(enrichment ? { enriched: fingerprint } : {}),
            }
            await save(session)
            if (!(await createDayFile(destination, content))) {
              delete topic.rename
              await save(session)
              continue
            }
            await completeRename(session, topic)
            return
          }
          throw new JournalError(
            'Could not allocate a journal filename. Your writing is saved; try naming it again.',
            500,
          )
        })
      })
    },
  }
}
