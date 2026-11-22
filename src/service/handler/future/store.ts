import { mkdir, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { Marked } from 'marked'
import { z } from 'zod'
import slugify from '#lib/string/slugify.ts'
import type { TrackingStore } from '#lib/tracking/store.ts'
import { formatTrackingValue, primaryTrackingColumn, trackingSeries } from '#lib/tracking/values.ts'
import { readTextFile } from '#shared/fs/mod.ts'
import GoalDocument, { activeGoalsDir, goalStatusFromPath } from '#shared/models/Goal/mod.ts'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import IdeaStore from '#shared/models/Store/IdeaStore/mod.ts'
import type { TrackingColumn } from '#shared/models/Tracking/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import {
  type FutureCheckpoint,
  type FutureDecisionTie,
  FutureError,
  type FutureGoal,
  type FutureGoalTie,
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

/** The goal's file with frontmatter keys changed; a `null` takes the key out. */
function withYaml(doc: GoalDocument, changes: Record<string, unknown>): GoalDocument {
  const yaml: Record<string, unknown> = { ...doc.yaml }
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === undefined) delete yaml[key]
    else yaml[key] = value
  }
  return new GoalDocument(yaml, doc.markdown)
}

export class FutureStore {
  constructor(
    readonly dirs: FutureDirs,
    readonly notebook: () => FutureNotebook | null,
    readonly tracking: Pick<TrackingStore, 'report'>,
    readonly today: () => Promise<PlainDate>,
  ) {}

  private ready(): FutureNotebook {
    const notebook = this.notebook()
    if (!notebook) throw new FutureError('Sky is still reading your notebook. Try again in a moment.', 503)
    return notebook
  }

  private relative(file: string): string {
    return path.relative(this.dirs.root, file).split(path.sep).join('/')
  }

  async report(): Promise<FutureReport> {
    const notebook = this.ready()
    const today = await this.today()
    const active = notebook.goals
      .getActive()
      .getAllItems()
      .map(({ doc, path: file }) => ({ doc, file, name: baseName(file), key: reference(`goals/${baseName(file)}`) }))
    const tie = (name: string | undefined): FutureGoalTie | null => {
      const found = name ? active.find((goal) => goal.key === reference(`goals/${name}`)) : undefined
      return found ? { name: found.name, title: found.doc.title } : null
    }
    const tiedTo = (rel: Iterable<string>): Set<string> => new Set([...rel].map(reference))

    const decisions = notebook.decisions
      .getAll()
      .getAllItems()
      .map(({ doc, path: file }) => ({
        rel: tiedTo(doc.rel),
        state: doc.inForce ? ('inForce' as const) : doc.isPending ? ('pending' as const) : ('decided' as const),
        tie: {
          name: baseName(file),
          title: doc.summary || firstHeading(doc.markdown) || baseName(file),
          file: this.relative(file),
          since: (doc.resolved ?? doc.identified)?.plainDateTime.plainDate.ymd ?? null,
        } satisfies FutureDecisionTie,
      }))
      // Newest first: what was decided last is what a person looks for.
      .sort((a, b) => (b.tie.since ?? '').localeCompare(a.tie.since ?? '') || a.tie.title.localeCompare(b.tie.title))
    const ideas = notebook.ideas
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
            } satisfies FutureIdeaTie,
          },
        ]
      })
    const habits = notebook.streaks
      .getActive()
      .getAllItems()
      .map(({ doc, path: file }) => ({
        rel: tiedTo(doc.rel),
        tie: { name: baseName(file), title: doc.title || baseName(file) } satisfies FutureHabitTie,
      }))

    const goals: FutureGoal[] = []
    for (const { doc, file, name, key } of active) {
      const mine = decisions.filter((decision) => decision.rel.has(key))
      const { number, problem, checkpoints } = await this.number(doc, today)
      goals.push({
        name,
        title: doc.title,
        category: doc.category,
        file: this.relative(file),
        bodyHtml: await markdown.parse(doc.markdown.replace(/^\s*# [^\n]*\n?/, '').trim(), { async: false }),
        due: doc.due?.ymd ?? null,
        start: doc.start?.ymd ?? null,
        daysLeft: doc.due ? daysFrom(today, doc.due) : null,
        number,
        numberProblem: problem,
        checkpoints,
        serves: tie(doc.serves),
        smaller: active
          .filter((other) => other.name !== name && other.doc.serves && reference(`goals/${other.doc.serves}`) === key)
          .map((other) => ({ name: other.name, title: other.doc.title })),
        inForce: mine.filter((decision) => decision.state === 'inForce').map((decision) => decision.tie),
        toDecide: mine.filter((decision) => decision.state === 'pending').map((decision) => decision.tie),
        decided: mine.filter((decision) => decision.state === 'decided').map((decision) => decision.tie),
        habits: habits.filter((habit) => habit.rel.has(key)).map((habit) => habit.tie),
        ideas: ideas.filter((idea) => idea.rel.has(key)).map((idea) => idea.tie),
      })
    }
    // A goal that serves another reads after the ones that stand on their own.
    goals.sort(
      (a, b) =>
        Number(Boolean(a.serves)) - Number(Boolean(b.serves)) ||
        a.title.localeCompare(b.title, undefined, { numeric: true }),
    )

    return {
      today: today.ymd,
      goals,
      inForce: decisions
        .filter((decision) => decision.state === 'inForce')
        .map((decision) => ({
          ...decision.tie,
          goals: active
            .filter((goal) => decision.rel.has(goal.key))
            .map((goal) => ({ name: goal.name, title: goal.doc.title })),
        })),
    }
  }

  /** Where a goal's number stands: read from its tracker, from the day work began through today. */
  private async number(
    doc: GoalDocument,
    today: PlainDate,
  ): Promise<{ number: FutureNumber | null; problem: string | null; checkpoints: FutureCheckpoint[] }> {
    const none = (problem: string | null) => ({ number: null, problem, checkpoints: [] })
    const track = doc.track
    if (!track) return none(null)
    const began = doc.start ?? doc.created ?? today.addDays(-90)
    const from = PlainDate.compare(began, today) > 0 ? today : began
    let column: TrackingColumn | undefined
    let metric
    try {
      const report = await this.tracking.report(from.ymd, today.ymd, track)
      metric = report.metrics[0]
      column = metric ? primaryTrackingColumn(metric.tracker) : undefined
    } catch {
      // A missing or unreadable tracker reads the same to the person: the number is not there.
    }
    if (!metric) return none(`This goal follows "${track}", which is not in Tracking any more.`)
    if (!column || !['number', 'duration'].includes(column.type))
      return none(`${metric.tracker.title} has no number to follow.`)

    const show = (value: number): string => formatTrackingValue(column, String(Number(value.toFixed(4))))
    const points: FuturePoint[] = trackingSeries(metric.entries, column, from.ymd, today.ymd).flatMap((point, day) =>
      point.value === null ? [] : [{ date: point.date, day, value: point.value, text: show(point.value) }],
    )
    const todayDay = daysFrom(from, today)
    const dueDay = doc.due && PlainDate.compare(doc.due, today) > 0 ? daysFrom(from, doc.due) : null
    const first = points[0] ?? null
    const latest = points.at(-1) ?? null
    const target = doc.target ?? null
    // Which way the number has to move, read from where it started.
    const direction = target === null || !first ? 0 : Math.sign(target - first.value)
    const met = (value: number, goal: number): boolean =>
      direction > 0 ? value >= goal : direction < 0 ? value <= goal : value === goal
    const reached = target !== null && latest !== null && met(latest.value, target)
    const moved = first && latest ? latest.value - first.value : null

    const checkpoints = doc.checkpoints.map((checkpoint): FutureCheckpoint => {
      const day = daysFrom(from, checkpoint.date)
      const past = PlainDate.compare(checkpoint.date, today) <= 0
      const then = past ? points.findLast((point) => point.date <= checkpoint.date.ymd) : latest
      return {
        value: checkpoint.value,
        text: show(checkpoint.value),
        date: checkpoint.date.ymd,
        day: day >= 0 && day <= (dueDay ?? todayDay) ? day : null,
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
        days: Math.max(1, dueDay ?? todayDay),
        todayDay,
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
      // An archived goal keeps its name too: `goals/<name>` must keep meaning one file.
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

  /** The file's checkpoint lines as written, without the one on `date`; a line Sky cannot read is kept. */
  private otherCheckpointLines(doc: GoalDocument, date: string): string[] {
    const lines = doc.yaml['checkpoints']
    return Array.isArray(lines)
      ? lines.filter((line): line is string => typeof line === 'string' && !line.trim().endsWith(` by ${date}`))
      : []
  }

  private async edit(
    name: string,
    today: PlainDate,
    change: (doc: GoalDocument) => GoalDocument,
  ): Promise<FutureMutation> {
    const notebook = this.ready()
    const entry = notebook.goals.find(name)
    if (!entry || goalStatusFromPath(entry.path) !== 'active')
      throw new FutureError(`"${name}" is not one of your active goals. It may have been renamed or archived.`, 404)
    // Read the file itself: the person may have edited it since the notebook was last read.
    const text = withYaml(change(GoalDocument.fromMarkdown(await readTextFile(entry.path))), {
      updated: today.ymd,
    }).toMarkdown()
    await writeFile(entry.path, text)
    notebook.goals.set(entry.path, text)
    return { name: baseName(entry.path) }
  }
}
