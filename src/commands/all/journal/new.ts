import * as path from 'node:path'
import colors from 'picocolors'
import { generateText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import slugify from '#lib/string/slugify.ts'
import openEditor from '#lib/shell/openEditor.ts'
import { DayDirFileWriter } from '#lib/nbfs/mod.ts'
import { isTerminal, readStdin, setRaw, writeStdout } from '#shared/sys/mod.ts'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { dayWord } from '#universal/dates/mod.ts'
import { z } from 'zod'
import { Command, CommandResult, Flag, whenNBTime } from '#commands/mod.ts'
import type { Args, CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import type { OutputHandler } from '#commands/lib/output/OutputHandler.ts'
import { JournalTypes } from '#shared/models/Journal/mod.ts'
import type { JournalType, Question } from '#shared/models/Journal/type.d.ts'
import JournalDocument from '#shared/models/Journal/document/mod.ts'
import createQuestions from '#shared/models/Journal/createQuestions.ts'
import { gatherContext } from './_lib/gatherContext.ts'
import { type GeneratedQuestion, generateQuestions } from './_lib/generateQuestions.ts'

const typesDescription = `Journal types: ${JournalTypes.join(', ')} (or any custom type with --from-audio)`

function validateFromAudioRequiresTypes(_result: Record<string, unknown>, rawArgs: Args): string | undefined {
  const hasFromAudio = rawArgs['from-audio'] !== undefined || rawArgs['fromAudio'] !== undefined
  const hasTypes = rawArgs['types'] !== undefined
  if (hasFromAudio && !hasTypes) {
    return '--from-audio requires --types to be specified (e.g. --types "Reflection")'
  }
  return undefined
}

const params = {
  all: Flag.boolean('Generate all journals', { short: 'a', default: false }),
  ai: Flag.boolean('Generate AI-powered contextual questions', { default: false }),
  inspectInitialContext: Flag.boolean('List initial context file paths and exit', { default: false }),
  dryRun: Flag.boolean('Show context and AI questions without creating files', { default: false }),
  fromAudio: Flag.string('Path to audio file, or omit path to search Desktop. Requires --types.', {
    optional: true,
  }),
  types: Flag.string(typesDescription, {
    parse: (val) => val.split(',').map((s) => s.trim()) as unknown as string,
    default: () => ['Mood'] as unknown as string,
    schema: z.any() as z.ZodType<string>,
  }),
  when: whenNBTime(),
}

type Params = InferParams<typeof params>

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'journal:new': { params: Params; result: undefined }
  }
}

export default class JournalNewTask extends Command {
  static override description: CommandDescription = {
    name: 'journal:new',
    description: 'Create journal file.',
    params,
    postProcess: [validateFromAudioRequiresTypes],
  }

  async run({ args, context, tasks }: CommandArgs<Params>): Promise<CommandResult> {
    const { config, output } = context
    const { when, all, ai, inspectInitialContext, dryRun, fromAudio } = args
    const types = args.types as unknown as JournalType[]

    // Handle --from-audio pipeline: transcribe → clean (no summarize)
    const useAudioPipeline = fromAudio !== undefined

    if (useAudioPipeline) {
      const journalType = types[0] as JournalType

      // Delegate to audio:transcript:clean which handles: transcribe → clean
      const cleanResult = await tasks.run('audio:transcript:clean', {
        fromAudio,
      })
      if (!cleanResult.ok || !cleanResult.data) {
        return CommandResult.fail(`Audio pipeline failed: ${cleanResult.message}`)
      }

      const data = cleanResult.data

      output.log(`\nTranscript cleaned: ${data.appliedCount} corrections applied, ${data.skippedCount} skipped`)

      // Show extracted metadata for confirmation
      let journalWhen = when
      let rel = [...data.who, ...data.rel].filter(Boolean)

      output.log(colors.cyan('\n─── Journal Metadata ───'))
      output.log(colors.white(`  Type:     ${journalType}`))
      output.log(colors.white(`  When:     ${journalWhen.date} ${journalWhen.time}`))
      output.log(colors.white(`  Who:      ${data.who.length > 0 ? data.who.join(', ') : '(none)'}`))
      output.log(colors.white(`  Rel:      ${data.rel.length > 0 ? data.rel.join(', ') : '(none)'}`))
      output.log(colors.cyan('────────────────────────'))

      // Ask for corrections when running in a terminal
      if (isTerminal()) {
        const corrections = await askForCorrections(output)
        if (corrections) {
          output.log(colors.cyan('\nParsing corrections...'))

          try {
            const parseResult = await generateText({
              model: anthropic('claude-sonnet-4-6'),
              prompt: `Parse these user corrections for journal metadata. Extract any fields the user is updating.

Current metadata:
- when: ${journalWhen.date} ${journalWhen.time}
- rel: ${JSON.stringify(rel)}

User corrections:
${corrections}

Return ONLY a JSON object with the fields that should be updated. Rules:
- "when" must be in format "YYYY-MM-DD HH:MM" (24-hour, zero-padded)
- "rel" must be an array of strings
- Only include fields that the user explicitly wants to change
- DO NOT include fields the user didn't mention`,
            })

            let jsonText = parseResult.text.trim()
            if (jsonText.startsWith('```')) {
              jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
            }
            const parsed = JSON.parse(jsonText)

            if (parsed.when) {
              journalWhen = new PlainDateTime(parsed.when)
            }
            if (Array.isArray(parsed.rel)) {
              rel = parsed.rel
            }

            output.log(colors.green('Applied corrections.'))
          } catch (err) {
            output.log(colors.yellow(`Failed to parse corrections: ${err}`))
          }
        }
      }

      // Build journal document using fromMarkdown so YAML is serialized properly
      const bodyMarkdown = [
        `# **${journalType}: ${journalWhen.date} - ${dayWord(
          journalWhen.toDayDateValue(),
          'short',
        )} - ${journalWhen.time}**`,
        '',
        data.cleanedText,
      ].join('\n')

      const doc = JournalDocument.fromMarkdown(bodyMarkdown)
      doc.yaml['rel'] = rel.length > 0 ? rel : null
      doc.yaml['tags'] = `Journal/${journalType.replaceAll(' ', '-')}`

      const ddfw = new DayDirFileWriter(journalWhen.plainDate)
      const fileSlug = slugify(journalType)
      const filePath = await ddfw.write(`journal/${fileSlug}.md`, doc.toMarkdown())
      const fullPath = path.join(ddfw.fullDir, filePath)

      output.log(`\n  Successfully created ${filePath}.\n`)
      openEditor([{ file: fullPath, line: 1, column: 0 }])

      return CommandResult.success()
    }

    let journalTypes = types

    // --all overrides everything
    if (all) {
      journalTypes = JournalTypes
    }

    const validTypes = journalTypes.filter((type: string) => {
      if (!JournalTypes.includes(<JournalType>type)) {
        output.log(`WARN: ${type} is not a valid journal type.`)
        return false
      }

      return true
    })

    // Gather AI questions if --ai flag is set
    let aiQuestions: GeneratedQuestion[] = []
    if (ai || inspectInitialContext) {
      output.log('Gathering context for AI questions...')
      const journalContext = await gatherContext(when.plainDate, when.time)

      output.log(
        `Context: ${journalContext.documentCount} kept, ${journalContext.prunedCount} pruned, ~${journalContext.totalTokens} tokens`,
      )

      if (inspectInitialContext) {
        const baseDir = <string>config.DIR_BASE
        const sorted = journalContext.paths.map((f) => (f.startsWith(baseDir) ? f.slice(baseDir.length + 1) : f)).sort()
        for (const f of sorted) {
          output.log(f)
        }
        output.log(`\nContext size: ${journalContext.contextMarkdown.length} chars`)
        return CommandResult.success()
      }

      if (dryRun) {
        output.log('\n=== CONTEXT ===')
        output.log(`Today: ${journalContext.today.date} (${journalContext.today.dayOfWeek})`)
        output.log(`Documents: ${journalContext.documentCount}`)
        output.log('')
        output.log(journalContext.contextMarkdown)
      }

      output.log('\nGenerating AI questions...')
      aiQuestions = await generateQuestions(journalContext)

      if (dryRun) {
        output.log('\n=== AI QUESTIONS ===')
        for (const q of aiQuestions) {
          output.log(`  [${q.type}] ${q.question}`)
        }
        return CommandResult.success()
      }

      output.log(`Generated ${aiQuestions.length} AI questions`)
    }

    // Group AI questions by type
    const aiQuestionsByType = new Map<JournalType, string[]>()
    for (const q of aiQuestions) {
      const existing = aiQuestionsByType.get(q.type) || []
      existing.push(`(AI) ${q.question}`)
      aiQuestionsByType.set(q.type, existing)
    }

    // Determine which types to create based on AI questions
    // If AI generated questions for a type not in validTypes, add it
    const typesToCreate = new Set<JournalType>(validTypes)
    for (const type of aiQuestionsByType.keys()) {
      typesToCreate.add(type)
    }

    const docs = await Promise.all(
      Array.from(typesToCreate).map(async (journalType: JournalType) => {
        let questions = await createQuestions(journalType, when.plainDate)
        const aiQuestionsForType = aiQuestionsByType.get(journalType)
        if (aiQuestionsForType) {
          const aiQuestionTuples: Question[] = aiQuestionsForType.map((q) => ['EVERY-DAY', 1.0, q])
          questions = [...aiQuestionTuples, ...questions]
        }
        return { type: journalType, doc: JournalDocument.create({ type: journalType, date: when, questions }) }
      }),
    )

    // I've noticed I have journaling bias by the first journal entry
    // which is usual gratitude or health, so I focus on these more
    // so by randomizing the start order it removes the bias
    const filePrefixes = docs.map((_, i) => String(i).padStart(2, '0'))
    shuffleArray(filePrefixes)

    const ddfw = new DayDirFileWriter(when.plainDate)

    const files = [] as { file: string; line: number; column: number }[]
    for (const { type, doc } of docs) {
      if (doc.questions.length === 0) continue // don't write an empty journal

      const prefix = filePrefixes.shift()
      const filePath = await ddfw.write(`journal/${prefix}_${slugify(type)}.md`, doc.toMarkdown())
      files.push({ file: path.join(ddfw.fullDir, filePath), line: 12, column: 0 })
      output.log(`\n  Successfully created ${filePath}.\n`)
    }

    // journals are in deterministic order, but have a shuffled prefixes
    // we need to do this, because on the file system
    // the prefixes do indeed introduce the shuffled order
    // but the file array itself due to the journals being in deterministic
    // order causes VS Code to show the tabs in the old order
    // we want the tab order to match the file system order
    files.sort((a, b) => a.file.localeCompare(b.file))

    openEditor(files)

    return CommandResult.success()
  }
}

/* Randomize array in-place using Durstenfeld shuffle algorithm */
// https://stackoverflow.com/a/12646864/10333
function shuffleArray(array: unknown[]): void {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[array[i], array[j]] = [array[j], array[i]]
  }
}

async function askForCorrections(output: OutputHandler): Promise<string | null> {
  output.log(colors.cyan('\nAny corrections? (Enter to accept, or type changes)'))
  output.log(colors.gray('  e.g., "when: 2026-03-03 22:30" or "rel: Alice, Bob"'))

  const isTTY = isTerminal()
  const decoder = new TextDecoder()
  const chunks: string[] = []

  writeStdout(colors.cyan('> '))

  if (isTTY) {
    setRaw(true)
  }

  try {
    while (true) {
      const buf = new Uint8Array(1)
      const n = await readStdin(buf)
      if (n === null) break

      const byte = buf[0]

      if (byte === 13 || byte === 10) {
        writeStdout('\n')
        break
      }
      if (byte === 3) {
        writeStdout('\n')
        return null
      }
      if (byte === 127 || byte === 8) {
        if (chunks.length > 0) {
          chunks.pop()
          writeStdout('\b \b')
        }
        continue
      }

      const char = decoder.decode(buf.subarray(0, 1))
      chunks.push(char)
      writeStdout(buf)
    }
  } finally {
    if (isTTY) {
      setRaw(false)
    }
  }

  const input = chunks.join('').trim()
  return input || null
}
