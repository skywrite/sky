import { mkdir, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { Marked } from 'marked'
import { z } from 'zod'
import type { WizardSummary } from '#lib/decisionWizard/session.ts'
import slugify from '#lib/string/slugify.ts'
import type { TrackingStore } from '#lib/tracking/store.ts'
import { formatTrackingValue, primaryTrackingColumn, trackingSeries } from '#lib/tracking/values.ts'
import { readTextFile } from '#shared/fs/mod.ts'
import GoalDocument, {
  activeGoalsDir,
  endedGoalsDir,
  GOAL_ENDINGS,
  goalStatusFromPath,
} from '#shared/models/Goal/mod.ts'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import IdeaStore from '#shared/models/Store/IdeaStore/mod.ts'
import type { TrackingColumn } from '#shared/models/Tracking/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import {
  type FutureCheckpoint,
  type FutureDecision,
  type FutureDecisionTie,
  type FutureEnding,
  FutureError,
  type FutureGoal,
  type FutureGoalTie,
  type FutureGoalView,
  type FutureHabitTie,
  type FutureIdeaTie,
  type FutureMutation,
  type FutureNumber,
  type FuturePoint,
  type FutureReport,
} from './types.ts'

export interface FutureDirs {
  /** The notebook's root; file links are written relative to it */
  root: string
  goalsDir: string
}

/** The live notebook, as far as this screen reads it */
export type FutureNotebook = Pick<MarkdownStore, 'goals' | 'decisions' | 'ideas' | 'streaks'>

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
const safeHref = (href: string): boolean => {
  try {
    return ['http:', 'https:', 'mailto:'].includes(new URL(href, 'https://example.com').protocol)
  } catch {
    return false
  }
}
// A goal's writing can hold pasted HTML or unsafe links; the page renders safe Markdown only.
const markdown = new Marked({
  renderer: {
    html: ({ text }) => escapeHtml(text),
    link({ href, tokens }) {
      const label = this.parser.parseInline(tokens)
      return safeHref(href) ? `<a href="${escapeHtml(href)}">${label}</a>` : label
    },
    image: ({ text }) => escapeHtml(text),
  },
})

const YmdSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Write the date as YYYY-MM-DD.')
  .refine((value) => {
    try {
      return new PlainDate(value).ymd === value
    } catch {
      return false
    }
  }, 'That date is not on the calendar.')

const GoalInput = z.object({
  title: z.string().trim().min(1, 'Say what the goal is.').max(160, 'Keep the goal to one line.'),
  category: z.enum(['Personal', 'Professional']),
  why: z.string().trim().max(20_000).default(''),
  due: YmdSchema.nullish(),
})

const NumberInput = z.object({
  track: z.string().trim().min(1, 'Choose the number to follow.').max(120),
  target: z.number({ error: 'Say what the number should reach.' }).finite(),
  due: YmdSchema.nullish(),
  start: YmdSchema.nullish(),
})

const CheckpointInput = z.object({
  value: z.number({ error: 'Say what the number should be.' }).finite(),
  date: YmdSchema,
})

const DateInput = z.object({ due: YmdSchema.nullable() })

const CloseInput = z.object({
  ending: z.enum(GOAL_ENDINGS, { error: 'Say how the goal ended.' }),
  ended: YmdSchema.nullish(),
  note: z.string().trim().max(5000).default(''),
})

/** Whole days from one date to another, negative when `to` comes first. */
function daysFrom(from: PlainDate, to: PlainDate): number {
  let days = 0
  for (let date = from; PlainDate.compare(date, to) < 0; date = date.addDays(1)) days++
  for (let date = from; PlainDate.compare(date, to) > 0; date = date.addDays(-1)) days--
  return days
}

const baseName = (file: string): string => path.basename(file, '.md')
const firstHeading = (body: string): string | undefined => body.match(/^# +(.+?)\s*$/m)?.[1]
/** A `rel:` entry and a goal's reference compare without case or stray spaces. */
const reference = (value: string): string => value.trim().toLowerCase()

const isEnding = (status: string): status is FutureEnding => (GOAL_ENDINGS as readonly string[]).includes(status)

/** The goal's file with frontmatter keys changed; a `null` takes the key out. */
function withYaml(doc: GoalDocument, changes: Record<string, unknown>): GoalDocument {
  const yaml: Record<string, unknown> = { ...doc.yaml }
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === undefined) delete yaml[key]
    else yaml[key] = value
  }
  return new GoalDocument(yaml, doc.markdown)
}

/** A goal this screen shows: one being pursued, or one that ended */
interface Shown {
  doc: GoalDocument
  file: string
  name: string
  /** `goals/<name>`, as a `rel:` entry is compared */
  key: string
  status: 'active' | FutureEnding
}

/** Everything in the notebook that can name a goal in its `rel:` */
interface Tied {
  decisions: Array<{
    rel: Set<string>
    state: 'inForce' | 'pending' | 'decided'
    target: string | null
    tie: FutureDecisionTie
  }>
  ideas: Array<{ rel: Set<string>; tie: FutureIdeaTie }>
  habits: Array<{ rel: Set<string>; tie: FutureHabitTie }>
}

export class FutureStore {
  constructor(
    readonly dirs: FutureDirs,
    readonly notebook: () => FutureNotebook | null,
    readonly tracking: Pick<TrackingStore, 'report'>,
    readonly today: () => Promise<PlainDate>,
    /** The decision wizards that were started and not finished */
    readonly wizards: () => Promise<WizardSummary[]> = async () => [],
  ) {}

  private ready(): FutureNotebook {
    const notebook = this.notebook()
    if (!notebook) throw new FutureError('Sky is still reading your notebook. Try again in a moment.', 503)
    return notebook
  }

  private relative(file: string): string {
    return path.relative(this.dirs.root, file).split(path.sep).join('/')
  }

  /**
   * The goals this screen shows. A goal archived before endings were recorded
   * has no ending to show, so it stays out; its file is still in the notebook.
   */
  private shown(notebook: FutureNotebook): Shown[] {
    return notebook.goals
      .getAll()
      .getAllItems()
      .flatMap(({ doc, path: file }) => {
        const status = goalStatusFromPath(file)
        return status === 'archived'
          ? []
          : [{ doc, file, name: baseName(file), key: reference(`goals/${baseName(file)}`), status }]
      })
  }

  private tied(notebook: FutureNotebook): Tied {
    const tiedTo = (rel: Iterable<string>): Set<string> => new Set([...rel].map(reference))
    return {
      decisions: notebook.decisions
        .getAll()
        .getAllItems()
        .map(({ doc, path: file }) => ({
          rel: tiedTo(doc.rel),
          state: doc.inForce ? ('inForce' as const) : doc.isPending ? ('pending' as const) : ('decided' as const),
          target: !doc.target ? null : 'plainDate' in doc.target ? doc.target.plainDate.ymd : doc.target.ymd,
          tie: {
            name: baseName(file),
            title: doc.summary || firstHeading(doc.markdown) || baseName(file),
            file: this.relative(file),
            since: (doc.resolved ?? doc.identified)?.plainDateTime.plainDate.ymd ?? null,
          },
        }))
        // Newest first: what was decided last is what a person looks for.
        .sort((a, b) => (b.tie.since ?? '').localeCompare(a.tie.since ?? '') || a.tie.title.localeCompare(b.tie.title)),
      ideas: notebook.ideas
        .getAll()
        .getAllItems()
        .flatMap(({ doc, path: file }) => {
          const status = IdeaStore.statusFromPath(file)
          if (status === 'archived') return []
          const title = typeof doc.yaml['title'] === 'string' ? doc.yaml['title'] : undefined
          return [
            {
              rel: tiedTo(doc.rel),
              tie: {
                name: baseName(file),
                title: title || firstHeading(doc.markdown) || baseName(file),
                file: this.relative(file),
                status,
              },
            },
          ]
        }),
      habits: notebook.streaks
        .getActive()
        .getAllItems()
        .map(({ doc, path: file }) => ({
          rel: tiedTo(doc.rel),
          tie: { name: baseName(file), title: doc.title || baseName(file) },
        })),
    }
  }

  async report(): Promise<FutureReport> {
    const notebook = this.ready()
    const today = await this.today()
    const all = this.shown(notebook)
    const tied = this.tied(notebook)
    const active = all.filter((goal) => goal.status === 'active')

    const goals: FutureGoal[] = []
    for (const goal of active) goals.push(await this.view(goal, all, tied, today))
    // A goal that serves another reads after the ones that stand on their own.
    goals.sort(
      (a, b) =>
        Number(Boolean(a.serves)) - Number(Boolean(b.serves)) ||
        a.title.localeCompare(b.title, undefined, { numeric: true }),
    )

    return {
      today: today.ymd,
      wizards: await this.wizards(),
      goals,
      past: all
        .flatMap(({ doc, name, status }) =>
          status === 'active'
            ? []
            : [
                {
                  name,
                  title: doc.title,
                  category: doc.category,
                  status,
                  ended: doc.ended?.ymd ?? null,
                  final: doc.final ?? null,
                },
              ],
        )
        .sort((a, b) => (b.ended ?? '').localeCompare(a.ended ?? '') || a.title.localeCompare(b.title)),
      decisions: tied.decisions
        .map(
          (decision): FutureDecision => ({
            ...decision.tie,
            state: decision.state === 'pending' ? 'open' : decision.state,
            target: decision.target,
            goals: active
              .filter((goal) => decision.rel.has(goal.key))
              .map((goal) => ({ name: goal.name, title: goal.doc.title })),
          }),
        )
        // Open ones first, the soonest to decide at the top; the rest keep newest first.
        .sort((a, b) => {
          const rank = { open: 0, inForce: 1, decided: 2 }
          return (
            rank[a.state] - rank[b.state] ||
            (a.state === 'open' ? (a.target ?? '9999').localeCompare(b.target ?? '9999') : 0)
          )
        }),
      inForce: tied.decisions
        .filter((decision) => decision.state === 'inForce')
        .map((decision) => ({
          ...decision.tie,
          goals: active
            .filter((goal) => decision.rel.has(goal.key))
            .map((goal) => ({ name: goal.name, title: goal.doc.title })),
        })),
    }
  }

  /** The titles of every decision already written down. */
  async decisionTitles(): Promise<string[]> {
    return this.tied(this.ready()).decisions.map((decision) => decision.tie.title)
  }

  /** One goal's page, whether it is being pursued or has ended. */
  async goal(name: string): Promise<FutureGoalView> {
    const notebook = this.ready()
    const today = await this.today()
    const all = this.shown(notebook)
    const found = all.find((goal) => goal.key === reference(`goals/${name}`))
    if (!found) throw new FutureError(`"${name}" is not one of your goals. It may have been renamed.`, 404)
    return { today: today.ymd, goal: await this.view(found, all, this.tied(notebook), today) }
  }

  private async view(goal: Shown, all: Shown[], tied: Tied, today: PlainDate): Promise<FutureGoal> {
    const { doc, file, name, key, status } = goal
    // An ended goal is read through the day it ended, so its page stays as it was that day.
    const through = status !== 'active' && doc.ended && PlainDate.compare(doc.ended, today) <= 0 ? doc.ended : today
    const { number, problem, checkpoints } = await this.number(doc, through, status !== 'active')
    const served = doc.serves ? all.find((other) => other.key === reference(`goals/${doc.serves}`)) : undefined
    const mine = tied.decisions.filter((decision) => decision.rel.has(key))
    return {
      name,
      title: doc.title,
      category: doc.category,
      status,
      ended: doc.ended?.ymd ?? null,
      final: doc.final ?? null,
      file: this.relative(file),
      bodyHtml: await markdown.parse(doc.markdown.replace(/^\s*# [^\n]*\n?/, '').trim(), { async: false }),
      due: doc.due?.ymd ?? null,
      start: doc.start?.ymd ?? null,
      daysLeft: status === 'active' && doc.due ? daysFrom(today, doc.due) : null,
      number,
      // Nothing can be fixed on a goal that ended, so a missing tracker is only said while it is active.
      numberProblem: status === 'active' ? problem : null,
      checkpoints,
      serves: served ? { name: served.name, title: served.doc.title } : null,
      smaller: all
        .filter(
          (other) =>
            other.status === 'active' &&
            other.name !== name &&
            other.doc.serves &&
            reference(`goals/${other.doc.serves}`) === key,
        )
        .map((other): FutureGoalTie => ({ name: other.name, title: other.doc.title })),
      inForce: mine.filter((decision) => decision.state === 'inForce').map((decision) => decision.tie),
      toDecide: mine.filter((decision) => decision.state === 'pending').map((decision) => decision.tie),
      decided: mine.filter((decision) => decision.state === 'decided').map((decision) => decision.tie),
      habits: tied.habits.filter((habit) => habit.rel.has(key)).map((habit) => habit.tie),
      ideas: tied.ideas.filter((idea) => idea.rel.has(key)).map((idea) => idea.tie),
    }
  }

  /**
   * Where a goal's number stands: read from its tracker, from the day work began through `through`.
   * An ended goal stops there: no date still ahead, and no checkpoint after the day it ended.
   */
  private async number(
    doc: GoalDocument,
    through: PlainDate,
    ended = false,
  ): Promise<{ number: FutureNumber | null; problem: string | null; checkpoints: FutureCheckpoint[] }> {
    const none = (problem: string | null) => ({ number: null, problem, checkpoints: [] })
    const track = doc.track
    if (!track) return none(null)
    const began = doc.start ?? doc.created ?? through.addDays(-90)
    const from = PlainDate.compare(began, through) > 0 ? through : began
    let column: TrackingColumn | undefined
    let metric
    try {
      const report = await this.tracking.report(from.ymd, through.ymd, track)
      metric = report.metrics[0]
      column = metric ? primaryTrackingColumn(metric.tracker) : undefined
    } catch {
      // A missing or unreadable tracker reads the same to the person: the number is not there.
    }
    if (!metric) return none(`This goal follows "${track}", which is not in Tracking any more.`)
    if (!column || !['number', 'duration'].includes(column.type))
      return none(`${metric.tracker.title} has no number to follow.`)

    const show = (value: number): string => formatTrackingValue(column, String(Number(value.toFixed(4))))
    const points: FuturePoint[] = trackingSeries(metric.entries, column, from.ymd, through.ymd).flatMap((point, day) =>
      point.value === null ? [] : [{ date: point.date, day, value: point.value, text: show(point.value) }],
    )
    const endDay = daysFrom(from, through)
    const dueDay = !ended && doc.due && PlainDate.compare(doc.due, through) > 0 ? daysFrom(from, doc.due) : null
    const first = points[0] ?? null
    const latest = points.at(-1) ?? null
    const target = doc.target ?? null
    // Which way the number has to move, read from where it started.
    const direction = target === null || !first ? 0 : Math.sign(target - first.value)
    const met = (value: number, goal: number): boolean =>
      direction > 0 ? value >= goal : direction < 0 ? value <= goal : value === goal
    const reached = target !== null && latest !== null && met(latest.value, target)
    const moved = first && latest ? latest.value - first.value : null

    const kept = ended
      ? doc.checkpoints.filter((checkpoint) => PlainDate.compare(checkpoint.date, through) <= 0)
      : doc.checkpoints
    const checkpoints = kept.map((checkpoint): FutureCheckpoint => {
      const day = daysFrom(from, checkpoint.date)
      const past = PlainDate.compare(checkpoint.date, through) <= 0
      const then = past ? points.findLast((point) => point.date <= checkpoint.date.ymd) : latest
      return {
        value: checkpoint.value,
        text: show(checkpoint.value),
        date: checkpoint.date.ymd,
        day: day >= 0 && day <= (dueDay ?? endDay) ? day : null,
        state: then && met(then.value, checkpoint.value) ? 'reached' : past ? 'missed' : 'ahead',
      }
    })

    return {
      problem: null,
      checkpoints,
      number: {
        tracker: metric.tracker.name,
        trackerTitle: metric.tracker.title,
        unit: column.unit ?? '',
        from: from.ymd,
        through: through.ymd,
        days: Math.max(1, dueDay ?? endDay),
        endDay,
        dueDay,
        points,
        first,
        latest,
        target,
        targetText: target === null ? null : show(target),
        movedText: moved === null ? null : `${moved < 0 ? '−' : moved > 0 ? '+' : ''}${show(Math.abs(moved))}`,
        toGoText: target === null || !latest ? null : show(Math.abs(target - latest.value)),
        progress:
          target === null || !first || !latest
            ? null
            : first.value === target
              ? Number(reached)
              : Math.min(1, Math.max(0, (latest.value - first.value) / (target - first.value))),
        reached,
      },
    }
  }

  /** A new goal: one file under goals/active, named after the goal. */
  async createGoal(input: unknown): Promise<FutureMutation> {
    const notebook = this.ready()
    const goal = GoalInput.parse(input)
    const today = await this.today()
    // Goals are found by name (`goals/<name>`), so the file is named after the goal, not after the moment.
    const base = slugify(goal.title, { preserveCase: true, suggestedLength: 60 })
    if (!base) throw new FutureError('Give the goal a name with a letter or a number in it.')
    const text = withYaml(new GoalDocument({}, `# ${goal.title}\n${goal.why ? `\n${goal.why}\n` : ''}`), {
      title: goal.title,
      category: goal.category,
      due: goal.due ?? null,
      created: today.ymd,
      updated: today.ymd,
    }).toMarkdown()
    const dir = activeGoalsDir(this.dirs.goalsDir)
    await mkdir(dir, { recursive: true })
    for (let attempt = 1; attempt <= 50; attempt++) {
      const name = attempt === 1 ? base : `${base}-${attempt}`
      // A goal that ended keeps its name too: `goals/<name>` must keep meaning one file.
      if (notebook.goals.find(name)) continue
      const file = path.join(dir, `${name}.md`)
      try {
        // `wx` refuses a file that is already there, even one that differs only in capitals.
        await writeFile(file, text, { flag: 'wx' })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue
        throw error
      }
      notebook.goals.set(file, text)
      return { name }
    }
    throw new FutureError(`There are already many goals named "${goal.title}". Give this one a different name.`, 409)
  }

  /** Connect the number a goal follows, with what it should reach and by when. */
  async setNumber(name: string, input: unknown): Promise<FutureMutation> {
    const { track, target, due, start } = NumberInput.parse(input)
    const today = await this.today()
    if (start && start > today.ymd) throw new FutureError('The start is a day that has already happened.')
    let followed
    try {
      followed = (await this.tracking.report(today.ymd, today.ymd, track)).metrics[0]
    } catch {
      // Reported below
    }
    const column = followed ? primaryTrackingColumn(followed.tracker) : undefined
    if (!followed || !column || !['number', 'duration'].includes(column.type))
      throw new FutureError(`"${track}" is not a number in Tracking. Choose one from the list.`)
    return this.edit(name, today, (doc) =>
      withYaml(doc, { track: followed.tracker.name, target, due: due ?? null, start: start ?? null }),
    )
  }

  /** Give a goal a new date, or take its date away. */
  async setDate(name: string, input: unknown): Promise<FutureMutation> {
    const { due } = DateInput.parse(input)
    return this.edit(name, await this.today(), (doc) => withYaml(doc, { due }))
  }

  /** Add the same number at an earlier date; a checkpoint already on that date is replaced. */
  async addCheckpoint(name: string, input: unknown): Promise<FutureMutation> {
    const { value, date } = CheckpointInput.parse(input)
    return this.edit(name, await this.today(), (doc) =>
      withYaml(doc, {
        checkpoints: [...this.otherCheckpointLines(doc, date), `${value} by ${date}`].sort((a, b) =>
          (a.split(' by ')[1] ?? '').localeCompare(b.split(' by ')[1] ?? ''),
        ),
      }),
    )
  }

  async removeCheckpoint(name: string, input: unknown): Promise<FutureMutation> {
    const { date } = CheckpointInput.pick({ date: true }).parse(input)
    return this.edit(name, await this.today(), (doc) => {
      const lines = this.otherCheckpointLines(doc, date)
      return withYaml(doc, { checkpoints: lines.length ? lines : null })
    })
  }

  /**
   * End a goal: reached, missed or dropped. The file moves to that ending's
   * folder under the year it ended, and keeps its name, so every
   * `goals/<name>` reference still finds it. It records the day and where the
   * number stood, because the folder cannot say those.
   */
  async closeGoal(name: string, input: unknown): Promise<FutureMutation> {
    const notebook = this.ready()
    const { ending, ended, note } = CloseInput.parse(input)
    const today = await this.today()
    const day = ended ? new PlainDate(ended) : today
    if (PlainDate.compare(day, today) > 0) throw new FutureError('A goal ends on a day that has already happened.')
    const file = this.active(notebook, name)
    // Read the file itself: the person may have edited it since the notebook was last read.
    const doc = GoalDocument.fromMarkdown(await readTextFile(file))
    const { number } = await this.number(doc, day)
    const body = note ? `${doc.markdown.trimEnd()}\n\n## How it ended\n\n${note}\n` : doc.markdown
    const text = withYaml(new GoalDocument(doc.yaml, body), {
      ended: day.ymd,
      final: number?.latest?.text ?? null,
      updated: today.ymd,
    }).toMarkdown()
    const to = path.join(endedGoalsDir(this.dirs.goalsDir, ending, day.year), path.basename(file))
    return this.move(notebook, file, to, text)
  }

  /** Bring an ended goal back to the ones being pursued; what was written about its ending stays in the file. */
  async reopenGoal(name: string): Promise<FutureMutation> {
    const notebook = this.ready()
    const today = await this.today()
    const entry = notebook.goals.find(name)
    if (!entry || !isEnding(goalStatusFromPath(entry.path)))
      throw new FutureError(`"${name}" is not a goal that ended. It may have been renamed or reopened already.`, 404)
    const text = withYaml(GoalDocument.fromMarkdown(await readTextFile(entry.path)), {
      ended: null,
      final: null,
      updated: today.ymd,
    }).toMarkdown()
    const to = path.join(activeGoalsDir(this.dirs.goalsDir), path.basename(entry.path))
    return this.move(notebook, entry.path, to, text)
  }

  /** The file's checkpoint lines as written, without the one on `date`; a line Sky cannot read is kept. */
  private otherCheckpointLines(doc: GoalDocument, date: string): string[] {
    const lines = doc.yaml['checkpoints']
    return Array.isArray(lines)
      ? lines.filter((line): line is string => typeof line === 'string' && !line.trim().endsWith(` by ${date}`))
      : []
  }

  /** The file of an active goal, or a refusal that says why it cannot be changed. */
  private active(notebook: FutureNotebook, name: string): string {
    const entry = notebook.goals.find(name)
    if (!entry || goalStatusFromPath(entry.path) !== 'active')
      throw new FutureError(`"${name}" is not one of your active goals. It may have been renamed or closed.`, 404)
    return entry.path
  }

  private async edit(
    name: string,
    today: PlainDate,
    change: (doc: GoalDocument) => GoalDocument,
  ): Promise<FutureMutation> {
    const notebook = this.ready()
    const file = this.active(notebook, name)
    // Read the file itself: the person may have edited it since the notebook was last read.
    const text = withYaml(change(GoalDocument.fromMarkdown(await readTextFile(file))), {
      updated: today.ymd,
    }).toMarkdown()
    await writeFile(file, text)
    notebook.goals.set(file, text)
    return { name: baseName(file) }
  }

  /** Write a goal's file in its new folder, then take the old one away. A file already there is never replaced. */
  private async move(notebook: FutureNotebook, from: string, to: string, text: string): Promise<FutureMutation> {
    await mkdir(path.dirname(to), { recursive: true })
    try {
      await writeFile(to, text, { flag: 'wx' })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      throw new FutureError(
        `There is already a file named ${path.basename(to)} in ${this.relative(path.dirname(to))}. Rename one of the two, then try again.`,
        409,
      )
    }
    await rm(from)
    notebook.goals.delete(from)
    notebook.goals.set(to, text)
    return { name: baseName(to) }
  }
}
