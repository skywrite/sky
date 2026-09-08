import * as p from '@clack/prompts'
import colors from 'picocolors'
import { Arg, Command, CommandResult } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { exists, readTextFile } from '#shared/fs/mod.ts'
import TrackingStore from '#shared/models/Store/TrackingStore/mod.ts'
import type { TrackingColumn, TrackingDocument } from '#shared/models/Tracking/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { currentMoment } from './lib/moment.ts'
import { isBareScalar, parseEntry, parseEntryDate, valueColumns } from './lib/parse.ts'
import { appendRecord, formatRow, hasEntryForDate, recordFilePath } from './lib/records.ts'

const params = {
  name: Arg.string('Only ask this tracking (slug) — asks even if already recorded today', { optional: true }),
}

type Params = InferParams<typeof params>

interface AskResult {
  recorded: string[]
  skipped: string[]
  already: string[]
}

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'track:ask': { params: Params; result: AskResult }
  }
}

/** Prompt order: the day's rhythm — morning metrics first, evening last. */
const ASK_ORDER: Record<string, number> = { morning: 0, anytime: 1, evening: 2 }

const NUMERIC = /^-?\d+(\.\d+)?$/

/** Sentinel for a Ctrl-C anywhere in a definition's prompts. */
const CANCELLED = Symbol('cancelled')

export default class TrackAskTask extends Command {
  static override description: CommandDescription = {
    name: 'track:ask',
    description: "Ask today's unanswered tracking questions and record the answers.",
    descriptionLong: [
      'Walks the active tracking definitions (tracking/active/) that carry a',
      'question, skips any already answered today, and asks the rest one at a',
      'time. Answers append to the annual tracking CSV, keyed by full date',
      '(or day letters for explicit legacy weekly storage), using the',
      'calendar day on the clock unless the answer names another day.',
      '',
      'Answers are plain language: a bare value ("180") writes directly, and',
      'anything richer ("3 mile run in the park at 6:30 am")',
      "is AI-mapped onto the definition's columns and shown as the exact row",
      'for a one-keystroke confirm before writing. If parsing fails, the',
      'columns and date are asked directly. Explicit dates and relative days',
      '("yesterday", "on Monday") set the entry date; unclear dates are asked.',
      '',
      'Enter on an empty prompt skips a question; Ctrl-C stops the session',
      '(already-written rows stay).',
      '',
      'With a name, asks only that tracking — and asks even when today',
      'already has an entry, appending another row.',
    ],
    usage: ['sky track:ask', 'sky track:ask weight'],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<AskResult>> {
    const { config, output } = context
    const { name } = args

    if (!process.stdout.isTTY) {
      return CommandResult.fail('track:ask is interactive — run it in a terminal')
    }

    const timeDir = config.DIR_TIME as string
    // The day a hand edit keys to: the calendar day on the clock — not the
    // notebook's open day, which stays yesterday until day:start runs.
    const { date: today, time: timeNow } = await currentMoment(timeDir)
    const dirs = { timeDir, dataTrackingDir: config.DIR_DATA_TRACKING as string }

    const store = await TrackingStore.build(config.DIR_TRACKING as string)

    // Named invocation targets one definition and skips the answered-today
    // check — naming it IS the intent to add a row now.
    let candidates: TrackingDocument[]
    let explicit = false
    if (name) {
      const found = store.find(name)
      if (!found) {
        const known = store
          .getActive()
          .toArray()
          .map(({ doc }) => (doc as TrackingDocument).name)
          .join(', ')
        return CommandResult.fail(`No tracking named "${name}". Active: ${known || '(none)'}`)
      }
      if (TrackingStore.statusFromPath(found.path) === 'archived') {
        output.log(colors.dim(`(${found.value.title} is archived — recording anyway)`))
      }
      candidates = [found.value]
      explicit = true
    } else {
      candidates = store
        .getActive()
        .toArray()
        .map(({ doc }) => doc as TrackingDocument)
        .filter((doc) => doc.question && doc.isTrackedOn(today))
        .sort((a, b) => (ASK_ORDER[a.ask] ?? 1) - (ASK_ORDER[b.ask] ?? 1))
    }

    if (candidates.length === 0) {
      output.log(colors.yellow('No active tracking definitions with a question found.'))
      return CommandResult.success({ recorded: [], skipped: [], already: [] })
    }

    const result: AskResult = { recorded: [], skipped: [], already: [] }
    let cancelled = false

    for (const def of candidates) {
      if (cancelled) break

      const todayFilePath = recordFilePath(dirs, def, today)
      const contents = (await exists(todayFilePath)) ? await readTextFile(todayFilePath) : ''

      if (hasEntryForDate(def, contents, today)) {
        if (!explicit) {
          result.already.push(def.name)
          output.log(colors.dim(`✓ ${def.title} — already recorded today`))
          continue
        }
        output.log(colors.dim(`${def.title} already has an entry today`))
      }

      if (valueColumns(def).length === 0) {
        output.log(colors.yellow(`⚠ ${def.title} — no answerable columns declared, skipping`))
        continue
      }

      // Re-asks the question until a row is written, the entry is skipped
      // (empty answer / rejected confirm loops back), or the session cancels.
      answering: while (true) {
        const answer = await p.text({
          message: def.question ?? `${def.title}?`,
          placeholder: entryHint(def),
        })
        if (p.isCancel(answer)) {
          cancelled = true
          break
        }
        const text = (answer ?? '').trim()
        if (text === '') {
          result.skipped.push(def.name)
          output.log(colors.dim(`− ${def.title} — skipped`))
          break
        }

        let values: Record<string, string>
        let entryDate: PlainDate | null = today
        let confirmRow = false

        if (isBareScalar(def, text)) {
          values = { [valueColumns(def)[0].name]: text }
        } else {
          confirmRow = true
          const spinner = p.spinner()
          spinner.start('Parsing…')
          const parsed = await parseEntry(def, text, { date: today.toString(), time: timeNow })
          spinner.stop(parsed ? 'Parsed' : 'Could not parse that')

          if (parsed) {
            values = parsed.values
            entryDate = parsed.date
          } else {
            const direct = await promptPerColumn(def)
            if (direct === CANCELLED) {
              cancelled = true
              break
            }
            values = direct
            entryDate = null
          }
        }

        // Auto-stamp entry time when the answer didn't state one — the way a
        // hand edit stamps when it happened.
        for (const column of def.columns) {
          if (column.type === 'time' && !(values[column.name] ?? '').trim()) {
            values[column.name] = timeNow
          }
        }

        if (!valueColumns(def).some((c) => (values[c.name] ?? '') !== '')) {
          result.skipped.push(def.name)
          output.log(colors.dim(`− ${def.title} — skipped`))
          break
        }

        if (entryDate === null) {
          const date = await promptEntryDate(today)
          if (date === CANCELLED) {
            cancelled = true
            break
          }
          entryDate = date
        }

        const filePath = recordFilePath(dirs, def, entryDate)
        const row = formatRow(def, entryDate, values)

        // Parsed and fallback rows get a check; bare scalars write directly.
        if (confirmRow) {
          const ok = await p.confirm({ message: `Write: ${row}`, initialValue: true })
          if (p.isCancel(ok)) {
            cancelled = true
            break
          }
          if (!ok) continue answering
        }

        await appendRecord(filePath, def, entryDate, values)
        result.recorded.push(def.name)
        const shortPath = filePath.startsWith(timeDir)
          ? `time${filePath.slice(timeDir.length)}`
          : filePath.startsWith(dirs.dataTrackingDir)
            ? `data/tracking${filePath.slice(dirs.dataTrackingDir.length)}`
            : filePath
        output.log(`${colors.green('✓')} ${def.title} — ${colors.bold(row)} → ${colors.dim(shortPath)}`)
        break
      }
    }

    const parts = [
      `${result.recorded.length} recorded`,
      result.already.length > 0 ? `${result.already.length} already done` : '',
      result.skipped.length > 0 ? `${result.skipped.length} skipped` : '',
      cancelled ? 'stopped early' : '',
    ].filter(Boolean)
    output.log('')
    output.log(colors.dim(parts.join(', ')))

    return CommandResult.success(result)
  }
}

async function promptEntryDate(today: PlainDate): Promise<PlainDate | typeof CANCELLED> {
  const answer = await p.text({
    message: 'Which date should this entry use? (YYYY-MM-DD)',
    placeholder: today.toString(),
    validate: (value) => (parseEntryDate(value) ? undefined : 'Enter a valid date as YYYY-MM-DD'),
  })
  if (p.isCancel(answer)) return CANCELLED
  return new PlainDate(answer.trim())
}

/** Per-column prompts — the no-AI fallback when parsing fails. */
async function promptPerColumn(def: TrackingDocument): Promise<Record<string, string> | typeof CANCELLED> {
  const values: Record<string, string> = {}
  for (const column of def.columns) {
    if (column.type === 'time') continue
    const answer = await p.text({
      message: columnLabel(column),
      placeholder: columnHint(column),
      validate: (value) => {
        const v = (value ?? '').trim()
        if (v === '') return undefined
        if ((column.type === 'number' || column.type === 'duration') && !NUMERIC.test(v)) {
          return 'Expected a number'
        }
        return undefined
      },
    })
    if (p.isCancel(answer)) return CANCELLED
    values[column.name] = (answer ?? '').trim()
  }
  return values
}

function columnLabel(column: TrackingColumn): string {
  return column.unit ? `${column.name} (${column.unit})` : column.name
}

function columnHint(column: TrackingColumn): string {
  if (column.name === 'notes') return 'enter to skip'
  if (column.type === 'range') return 'e.g. 21:00-6:00'
  if (column.unit) return column.unit
  return ''
}

function entryHint(def: TrackingDocument): string {
  const columns = valueColumns(def)
  if (columns.length === 1 && columns[0].unit) return `${columns[0].unit} — enter to skip`
  return 'plain words work — enter to skip'
}
