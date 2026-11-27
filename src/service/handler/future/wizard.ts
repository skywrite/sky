import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { z } from 'zod'
import type { DecidedAnswers, DecidingAnswers } from '#lib/decisionWizard/answers.ts'
import type { DecidedPlan, DecidingPlan, Find } from '#lib/decisionWizard/plan.ts'
import { decidedRecord, decidingRecord, type DecisionRecord, recordMarkdown } from '#lib/decisionWizard/record.ts'
import {
  chosenOptions,
  decidedReady,
  decidedScreens,
  decidingReady,
  decidingScreens,
} from '#lib/decisionWizard/screens.ts'
import type { FindsView, WizardSaved, WizardSession, WizardSummary } from '#lib/decisionWizard/session.ts'
import type { DecisionThinking } from '#lib/decisionWizard/think.ts'
import { decisionThreadId } from '#lib/decisionWizard/thread.ts'
import { inOwnWords } from '#lib/decisionWizard/wire.ts'
import { readTextFile } from '#shared/fs/mod.ts'
import type { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { hold } from '../../activity.ts'
import type { DecisionCommands } from './decisionCommands.ts'
import type { FutureNotebook } from './store.ts'
import { FutureError, type FutureWeighing } from './types.ts'

/**
 * The decision wizard's server side: the runs in progress, Sky's thinking for
 * each, and the writes a run ends in.
 *
 * A run is Sky's working state, kept as one JSON file in the state folder. A
 * decision being made is also written to the notebook as an open decision
 * once the person moves past the first step, and rewritten at each step.
 * Saving at the end settles it, and adds the to-dos they asked for and a
 * reminder on each day they chose to look back. A decision already made is
 * written once, when it is saved.
 *
 * Thinking takes minutes, so it runs in the background and the page reads the
 * run to see where it stands. A run outlives the page, the tab and a service
 * restart; a think that a restart cut short is reported as such and can be
 * started again.
 */

const StartInput = z.object({
  statement: z.string().trim().min(1, 'Say what the decision is, in your own words.').max(2000),
  why: z.string().trim().max(600).nullish(),
  decided: z.boolean(),
})
const ProgressInput = z.object({
  answers: z.record(z.string(), z.unknown()),
  step: z.string().max(40).nullable(),
  /** The person is leaving the step or the page: the notebook's copy is brought up to date now */
  now: z.boolean().optional(),
})
const AddInput = z.object({
  kind: z.enum(['option', 'want']),
  text: z.string().trim().min(1, 'Say what to add.').max(600),
  /** An option typed in at the call: once Sky has worked it out, it is the call */
  call: z.boolean().optional(),
  /** Why, in the person's own words; kept beside the call */
  because: z.string().trim().max(2000).optional(),
})
const RewordInput = z.object({ text: z.string().trim().min(1, 'Say the decision in your own words.').max(2000) })

/** A run's answers are a few kilobytes; anything far larger is not this page talking. */
const MAX_ANSWERS = 200_000
/** Run ids are opaque job ids in Sky's state folder, not notebook records, so they carry no date or title. */
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/** Epoch milliseconds, for "how long has Sky been thinking". */
const nowMs = (): number => Math.round(performance.timeOrigin + performance.now())
const INTERRUPTED = 'Sky was interrupted before it finished thinking. Start it again.'
const said = (error: unknown): string => (error instanceof Error ? error.message : String(error))
const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()

export interface DecisionWizardOptions {
  /** Where runs are kept: Sky's own state, outside the notebook */
  dir: string
  thinking: DecisionThinking
  commands: DecisionCommands
  notebook: () => FutureNotebook | null
  today: () => Promise<PlainDate>
  /** The run's decision is now in the notebook under this name: a chat about the decision can point to it */
  filed?: (run: string, name: string) => Promise<void>
  /** The notebook path the run's chat was filed at, once it has been closed and filed */
  chatFiledAt?: (run: string) => Promise<string | null>
}

export class DecisionWizard {
  /** Thinking that is running in this process, by run id (`<id>:add` for a typed-in option or want) */
  private readonly running = new Set<string>()
  /** One write at a time per run: the think reports progress while the page saves answers */
  private readonly queues = new Map<string, Promise<unknown>>()
  /** One write at a time to a run's open decision in the notebook */
  private readonly filing = new Map<string, Promise<void>>()
  private finding = false

  constructor(private readonly options: DecisionWizardOptions) {}

  private file(id: string, kind: 'json' | 'evidence.md' = 'json'): string {
    if (!ID.test(id)) throw new FutureError('That wizard does not exist.', 404)
    return path.join(this.options.dir, 'runs', `${id}.${kind}`)
  }

  private async load(id: string): Promise<WizardSession> {
    const file = this.file(id)
    try {
      return JSON.parse(await readFile(file, 'utf8')) as WizardSession
    } catch {
      throw new FutureError('That wizard is gone. It may have been saved or discarded in another tab.', 404)
    }
  }

  /** Change a run under its queue, so a progress report and a saved answer never overwrite each other. */
  private change(id: string, edit: (session: WizardSession) => WizardSession | void): Promise<WizardSession> {
    const next = (this.queues.get(id) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const session = await this.load(id)
        const changed = edit(session) ?? session
        await mkdir(path.dirname(this.file(id)), { recursive: true })
        await writeFile(this.file(id), JSON.stringify(changed, null, 2))
        return changed
      })
    this.queues.set(id, next)
    return next
  }

  private titleOf(session: WizardSession): string {
    const { plan } = session
    if (!plan) return session.statement
    // Sky's suggested wording is an offer: the run keeps the person's own words until they choose one.
    if (plan.kind === 'decided') return (session.answers as DecidedAnswers).wording ?? session.statement
    return plan.frames[(session.answers as DecidingAnswers).frame ?? -1]?.title ?? session.statement
  }

  /** A run as the page should see it: thinking that this process is not doing was cut short. */
  private async settled(session: WizardSession): Promise<WizardSession> {
    const cut = session.status === 'thinking' && !this.running.has(session.id)
    const cutAdding = session.adding && !session.adding.error && !this.running.has(`${session.id}:add`)
    if (!cut && !cutAdding) return session
    return this.change(session.id, (current) => {
      if (cut && current.status === 'thinking')
        Object.assign(current, { status: 'failed', stage: null, error: INTERRUPTED })
      if (cutAdding && current.adding && !current.adding.error) current.adding.error = INTERRUPTED
    })
  }

  private think(id: string): void {
    this.running.add(id)
    const release = hold('thinking through a decision')
    void (async () => {
      try {
        const session = await this.load(id)
        const result = await this.options.thinking.plan(
          { statement: session.statement, why: session.why ?? undefined, decided: session.decided },
          (stage, read) => {
            void this.change(id, (current) => void Object.assign(current, { stage, read: read ?? current.read })).catch(
              () => {},
            )
          },
        )
        await writeFile(this.file(id, 'evidence.md'), result.related)
        await this.change(
          id,
          (current) =>
            void Object.assign(current, {
              status: 'ready',
              stage: null,
              since: null,
              error: null,
              plan: result.plan,
              read: result.read,
              answers: {},
              step: null,
            }),
        )
      } catch (error) {
        // A run discarded while Sky was thinking has no file left to report into.
        await this.change(
          id,
          (current) =>
            void Object.assign(current, {
              status: 'failed',
              stage: null,
              error: `Sky could not think this through: ${said(error)}`,
            }),
        ).catch(() => {})
      } finally {
        this.running.delete(id)
        release()
      }
    })()
  }

  async start(input: unknown): Promise<WizardSession> {
    const { statement, why, decided } = StartInput.parse(input)
    const session: WizardSession = {
      id: crypto.randomUUID(),
      statement,
      why: why || null,
      decided,
      status: 'thinking',
      stage: 'reading',
      since: nowMs(),
      read: null,
      error: null,
      plan: null,
      answers: {},
      step: null,
      adding: null,
      open: null,
    }
    await mkdir(path.dirname(this.file(session.id)), { recursive: true })
    await writeFile(this.file(session.id), JSON.stringify(session, null, 2))
    this.think(session.id)
    return session
  }

  /**
   * Where to talk the decision through: the chat's own thread, and the file it was put in if it has been
   * closed and filed. A filed chat is reopened from its file, so the conversation carries on.
   */
  async chat(id: string): Promise<{ thread: string; filed: string | null }> {
    await this.load(id)
    const filed = await this.options.chatFiledAt?.(id).catch(() => null)
    return { thread: decisionThreadId(id), filed: filed ?? null }
  }

  async get(id: string): Promise<WizardSession> {
    return this.settled(await this.load(id))
  }

  /** Every run that was started and not finished, for the Decisions list. */
  async list(): Promise<WizardSummary[]> {
    return (await this.sessions()).map((session) => ({
      id: session.id,
      title: this.titleOf(session),
      status: session.status,
      decided: session.decided,
      open: session.open,
    }))
  }

  private async sessions(): Promise<WizardSession[]> {
    const names = await readdir(path.join(this.options.dir, 'runs')).catch(() => [] as string[])
    const sessions: WizardSession[] = []
    for (const name of names.filter((file) => file.endsWith('.json')).sort()) {
      try {
        sessions.push(await this.settled(await this.load(name.slice(0, -'.json'.length))))
      } catch {
        // A file that is not a run is not listed.
      }
    }
    return sessions
  }

  /** Where the weighing of a decision is kept once its call is saved and its run is gone. */
  private weighedFile(name: string): string | null {
    return /^[\w.-]+$/.test(name) ? path.join(this.options.dir, 'weighed', `${name}.json`) : null
  }

  /**
   * How the options stood against what the person wants, for the decision's own page: from the run still open
   * on it, or as it stood the day the call was saved. Null for a decision that never went through the wizard.
   */
  async weighing(name: string): Promise<FutureWeighing | null> {
    for (const session of await this.sessions())
      if (session.open === name && session.plan?.kind === 'deciding')
        return { run: session.id, plan: session.plan, answers: session.answers as DecidingAnswers }
    const file = this.weighedFile(name)
    if (!file) return null
    try {
      const kept = JSON.parse(await readFile(file, 'utf8')) as Pick<FutureWeighing, 'plan' | 'answers'>
      return kept.plan?.kind === 'deciding' ? { run: null, plan: kept.plan, answers: kept.answers ?? {} } : null
    } catch {
      return null
    }
  }

  /** Keep the person's answers and the step they are on, so a reload or a later visit picks up there. */
  async progress(id: string, input: unknown): Promise<WizardSession> {
    const { answers, step, now } = ProgressInput.parse(input)
    if (JSON.stringify(answers).length > MAX_ANSWERS) throw new FutureError('Those answers are too large to keep.')
    await this.change(id, (session) => {
      if (session.status !== 'ready') throw new FutureError('Sky is still thinking this through.', 409)
      Object.assign(session, { answers, step })
    })
    // The answers are kept either way; a notebook write that fails is retried at the next step.
    await this.keepFiled(id, now === true).catch(() => {})
    return this.load(id)
  }

  /**
   * Keep the notebook's copy in step with the wizard. A decision being made is
   * written as an open decision once the person moves past the first step, and
   * rewritten each time they move on, so it is a real record from the start:
   * listed under To decide, pinned in every chat, and there to point to.
   *
   * A file the person changed by hand is left alone from then on; saving the
   * decision at the end still settles it.
   */
  private keepFiled(id: string, force = false): Promise<void> {
    const next = (this.filing.get(id) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const session = await this.load(id)
        const { plan } = session
        if (session.status !== 'ready' || plan?.kind !== 'deciding') return
        const answers = session.answers as DecidingAnswers
        const record = decidingRecord(plan, answers, true, session.statement)
        const { desiredOutcomes, record: sections } = recordMarkdown(record)
        if (!session.open) {
          const first = decidingScreens(plan, answers)[0]?.id
          const started = session.step !== null && session.step !== first && Object.keys(answers).length > 0
          if (!started) return
          const created = await this.options.commands.create({
            title: record.title,
            context: record.context,
            desiredOutcomes,
            record: sections || undefined,
            inForce: false,
            target: record.target ?? undefined,
            rel: this.refs(record),
            category: record.category,
            noEditor: true,
          })
          await this.noted(created.file)
          const text = await readTextFile(created.file).catch(() => null)
          await this.change(
            id,
            (current) => void Object.assign(current, { open: created.name, openText: text, openStep: session.step }),
          )
          await this.filed(id, created.name, [])
          return
        }
        const file = this.openFile(session)
        if (!file || session.openText == null) return
        if (!force && session.openStep === session.step) return
        const written = await this.options.commands.update({
          file,
          title: record.title,
          context: record.context,
          desiredOutcomes,
          record: sections || undefined,
          target: record.target,
          rel: this.refs(record),
          expected: session.openText,
        })
        await this.change(
          id,
          (current) =>
            void Object.assign(current, { openText: written.edited ? null : written.text, openStep: session.step }),
        )
        if (!written.edited) await this.noted(file)
      })
    this.filing.set(id, next)
    return next
  }

  /** Start the thinking again after it failed or was cut short. */
  async retry(id: string): Promise<WizardSession> {
    const session = await this.change(id, (current) => {
      if (current.status === 'thinking' && this.running.has(id))
        throw new FutureError('Sky is already thinking this through.', 409)
      Object.assign(current, { status: 'thinking', stage: 'reading', since: nowMs(), error: null })
    })
    this.think(id)
    return session
  }

  /** The person put the decision in their own words: that can change what is being decided, so Sky starts over. */
  async reword(id: string, input: unknown): Promise<WizardSession> {
    const { text } = RewordInput.parse(input)
    const session = await this.change(id, (current) => {
      if (current.status !== 'ready') throw new FutureError('Sky is still thinking this through.', 409)
      Object.assign(current, {
        statement: text,
        why: null,
        status: 'thinking',
        stage: 'reading',
        since: nowMs(),
        error: null,
        plan: null,
        answers: {},
        step: null,
        adding: null,
      })
    })
    this.think(id)
    return session
  }

  /** An option or a want the person typed in: Sky works it out against the plan and adds it. */
  async add(id: string, input: unknown): Promise<WizardSession> {
    const { kind, text, call, because } = AddInput.parse(input)
    const asCall = kind === 'option' && call === true
    const session = await this.change(id, (current) => {
      if (current.status !== 'ready' || current.plan?.kind !== 'deciding')
        throw new FutureError('There is no plan to add that to yet.', 409)
      if (current.adding && !current.adding.error)
        throw new FutureError('Sky is already working out something you added.', 409)
      // The reason is kept on the addition while Sky works, so a failed think can be tried again without retyping it.
      current.adding = {
        kind,
        text,
        since: nowMs(),
        error: null,
        ...(asCall ? { call: true, because: because ?? '' } : {}),
      }
    })
    const key = `${id}:add`
    this.running.add(key)
    const release = hold('working out an addition to a decision')
    void (async () => {
      try {
        const plan = session.plan as DecidingPlan
        const title = this.titleOf(session)
        const worked =
          kind === 'option'
            ? await this.options.thinking.addOption({
                plan,
                title,
                text,
                related: await readTextFile(this.file(id, 'evidence.md')).catch(() => ''),
              })
            : await this.options.thinking.addWant({ plan, title, text })
        const extended = asCall ? inOwnWords(worked, text) : worked
        await this.change(id, (current) => {
          const answers = current.answers as DecidingAnswers
          current.plan = extended
          current.adding = null
          // What the person added is theirs to weigh: it joins what they had ticked.
          if (kind === 'option') {
            const added = extended.options.length - 1
            answers.options = [...(answers.options ?? plan.options.map((_, at) => at)), added]
            if (asCall) {
              // Typed in at the call, so it is the call. Sky is not told the reason: its read of the option stays
              // its own, and what it would do is still held back until the person moves on.
              answers.call = added
              delete answers.final
              answers.because = { ...answers.because, [added]: because ?? '' }
            }
          } else answers.wants = [...(answers.wants ?? []), extended.wants.length - 1]
        })
      } catch (error) {
        await this.change(id, (current) => {
          if (current.adding) current.adding.error = `Sky could not work that out: ${said(error)}`
        }).catch(() => {})
      } finally {
        this.running.delete(key)
        release()
      }
    })()
    return session
  }

  /** Drop what the person typed in after Sky failed to work it out. */
  async dropAddition(id: string): Promise<WizardSession> {
    return this.change(id, (session) => {
      if (session.adding && !session.adding.error && this.running.has(`${id}:add`))
        throw new FutureError('Sky is still working that out.', 409)
      session.adding = null
    })
  }

  async discard(id: string): Promise<void> {
    await rm(this.file(id), { force: true })
    await rm(this.file(id, 'evidence.md'), { force: true })
  }

  private async ready(id: string): Promise<WizardSession & { plan: DecidingPlan | DecidedPlan }> {
    const session = await this.get(id)
    if (session.status !== 'ready' || !session.plan) throw new FutureError('Sky is still thinking this through.', 409)
    return session as WizardSession & { plan: DecidingPlan | DecidedPlan }
  }

  /** References the notebook can still resolve; a goal or decision renamed since the plan was made is dropped. */
  private refs(record: DecisionRecord): string[] {
    const notebook = this.options.notebook()
    if (!notebook) return []
    return record.rel.filter((ref) => {
      const [kind, name] = [ref.slice(0, ref.indexOf('/')), ref.slice(ref.indexOf('/') + 1)]
      return kind === 'goals'
        ? Boolean(notebook.goals.find(name))
        : kind === 'decisions'
          ? Boolean(notebook.decisions.find(name))
          : false
    })
  }

  /** The file of the open decision this run saved earlier, while it is still open. */
  private openFile(session: WizardSession): string | undefined {
    const entry = session.open ? this.options.notebook()?.decisions.find(session.open) : undefined
    return entry && entry.path.includes('/pending/') ? entry.path : undefined
  }

  /** Tell whoever ties a chat to its decision. The decision is saved either way, so a failure is only said. */
  private async filed(id: string, name: string, warnings: string[]): Promise<void> {
    try {
      await this.options.filed?.(id, name)
    } catch (error) {
      warnings.push(`The chat about this decision was not tied to it: ${said(error)}`)
    }
  }

  private async noted(file: string, old?: string): Promise<void> {
    const notebook = this.options.notebook()
    if (!notebook) return
    try {
      // The page reads again at once; the notebook's own reading of the new file can be a moment behind.
      if (old && old !== file) notebook.decisions.delete(old)
      notebook.decisions.set(file, await readTextFile(file))
    } catch {
      // The file watcher brings it in.
    }
  }

  /**
   * Stop before the call is made, to check something first. The decision is
   * already in the notebook as open; this brings it up to date with the day to
   * decide by and adds the checks the person asked for as to-dos. The run
   * stays, and the wizard picks up at the call when the person comes back.
   */
  async saveOpen(id: string): Promise<WizardSaved> {
    const before = await this.ready(id)
    if (before.plan.kind !== 'deciding') throw new FutureError('A decision already made is saved in one step.')
    // The open decision is written, or brought up to date with the day to decide by.
    await this.keepFiled(id, true)
    const session = await this.ready(id)
    const plan = session.plan as DecidingPlan
    const answers = session.answers as DecidingAnswers
    const record = decidingRecord(plan, answers, true, session.statement)
    const warnings: string[] = []
    let name = session.open
    if (!this.openFile(session)) {
      // A run that never left its first step has no file yet.
      const { desiredOutcomes, record: sections } = recordMarkdown(record)
      const created = await this.options.commands.create({
        title: record.title,
        context: record.context,
        desiredOutcomes,
        record: sections || undefined,
        inForce: false,
        target: record.target ?? undefined,
        rel: this.refs(record),
        category: record.category,
        noEditor: true,
      })
      name = created.name
      await this.noted(created.file)
      const text = await readTextFile(created.file).catch(() => null)
      await this.change(
        id,
        (current) => void Object.assign(current, { open: created.name, openText: text, openStep: session.step }),
      )
      await this.filed(id, created.name, warnings)
    } else if (session.openText == null)
      warnings.push(
        'The decision’s file was changed by hand, so Sky left it as it is. The day to decide by is not in it.',
      )
    const today = (await this.options.today()).ymd
    const chosen = chosenOptions(plan, answers)
    const checks = chosen.flatMap((option) => plan.options[option]!.hinges)
    const todos: string[] = []
    for (const at of answers.hinge === 'check' ? (answers.todos ?? []) : []) {
      const todo = checks[at]?.todo
      if (!todo) continue
      try {
        await this.options.commands.addItem({ task: todo, list: 'todos', when: today, category: record.category })
        todos.push(todo)
      } catch (error) {
        warnings.push(`“${todo}” was not added to today’s to-dos: ${said(error)}`)
      }
    }
    // The next visit picks up at the call. How the checks came out is the person's to bring back.
    await this.change(id, (current) => {
      ;(current.answers as DecidingAnswers).hinge = 'checked'
      current.step = 'call'
    })
    return { name: name!, title: record.title, open: true, inForce: false, when: null, look: [], todos, warnings }
  }

  /**
   * Save the decision as made. A run that was saved as open settles that open
   * decision; any other run writes a new one. A reminder goes on each day the
   * person chose to look back.
   */
  async save(id: string): Promise<WizardSaved> {
    const session = await this.ready(id)
    let record: DecisionRecord
    if (session.plan.kind === 'decided') {
      const answers = session.answers as DecidedAnswers
      const missing = decidedScreens(session.plan).find((screen) => !decidedReady(screen.id, answers))
      if (missing) throw new FutureError('The wizard has a step left to answer before this can be saved.', 409)
      record = decidedRecord(session.plan, answers)
    } else {
      const { plan } = session
      const answers = session.answers as DecidingAnswers
      const screens = decidingScreens(plan, answers)
      if (
        screens.some((screen) => screen.id === 'open') ||
        screens.some((screen) => !decidingReady(screen.id, plan, answers))
      )
        throw new FutureError('The wizard has a step left to answer before this can be saved.', 409)
      record = decidingRecord(plan, answers)
    }
    const { desiredOutcomes, record: sections, decision } = recordMarkdown(record)
    const fields = {
      title: record.title,
      context: record.context,
      desiredOutcomes,
      record: sections || undefined,
      decision: decision!,
      inForce: record.inForce,
      rel: this.refs(record),
      category: record.category,
    }
    const open = this.openFile(session)
    const today = (await this.options.today()).ymd
    const written = open
      ? await this.options.commands.settle({ ...fields, file: open })
      : await this.options.commands.create({
          ...fields,
          when: record.when && record.when !== today ? record.when : undefined,
        })
    await this.noted(written.file, open)

    const warnings: string[] = []
    await this.filed(id, written.name, warnings)
    const look: string[] = []
    for (const day of record.look) {
      try {
        await this.options.commands.addItem({
          task: `Look back on “${record.title}”: did it go the way you expected?`,
          list: 'reminders',
          when: day,
          category: record.category,
        })
        look.push(day)
      } catch (error) {
        warnings.push(`The reminder for ${day} was not set: ${said(error)}`)
      }
    }
    // The run ends here. What was weighed stays with the decision, so its page can still show it.
    const weighed = session.plan.kind === 'deciding' ? this.weighedFile(written.name) : null
    if (weighed) {
      await mkdir(path.dirname(weighed), { recursive: true })
      await writeFile(weighed, JSON.stringify({ plan: session.plan, answers: session.answers })).catch(() => {})
    }
    await this.discard(id)
    return {
      name: written.name,
      title: record.title,
      open: false,
      inForce: record.inForce,
      when: record.when && record.when !== today ? record.when : null,
      look,
      todos: [],
      warnings,
    }
  }

  /**
   * Decisions the notebook points to, found once a day. `known` are the titles
   * already written down; a find that has since become a decision or a run is
   * left out.
   */
  async finds(known: string[], again = false): Promise<FindsView> {
    const file = path.join(this.options.dir, 'finds.json')
    const today = (await this.options.today()).ymd
    let state: (FindsView & { day: string }) | null = null
    try {
      state = JSON.parse(await readFile(file, 'utf8'))
    } catch {
      // Nothing found yet.
    }
    const stale = !state || state.day !== today || (state.status === 'looking' && !this.finding)
    if ((stale || again) && !this.finding) {
      this.finding = true
      state = { day: today, status: 'looking', finds: [], error: null }
      await mkdir(this.options.dir, { recursive: true })
      await writeFile(file, JSON.stringify(state))
      const release = hold('looking for decisions in the notebook')
      void (async () => {
        let next: FindsView & { day: string }
        try {
          next = { day: today, status: 'ready', finds: await this.options.thinking.find({ known }), error: null }
        } catch (error) {
          next = {
            day: today,
            status: 'failed',
            finds: [],
            error: `Sky could not look through your notebook: ${said(error)}`,
          }
        }
        await writeFile(file, JSON.stringify(next)).catch(() => {})
        this.finding = false
        release()
      })()
    }
    const taken = [...known, ...(await this.list()).map((run) => run.title)]
    const finds: Find[] = (state?.finds ?? []).filter((find) => !taken.some((title) => same(title, find.title)))
    return { status: state?.status ?? 'looking', finds, error: state?.error ?? null }
  }
}
