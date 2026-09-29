import * as path from 'node:path'
import colors from 'picocolors'
import { z } from 'zod'
import { Command, CommandPlatform, CommandResult, Flag, whenNBTime } from '#commands/mod.ts'
import type { Args, CommandArgs, CommandDescription, InferParams, InferParamsInput } from '#commands/mod.ts'
import { DayDirFileWriter } from '#lib/nbfs/mod.ts'
import openEditor from '#lib/shell/openEditor.ts'
import slugify from '#lib/string/slugify.ts'
import createQuestions from '#shared/models/Journal/createQuestions.ts'
import JournalDocument from '#shared/models/Journal/document/mod.ts'
import { JournalTypes } from '#shared/models/Journal/mod.ts'
import type { JournalType, Question } from '#shared/models/Journal/type.d.ts'
import { type GeneratedQuestion, generateQuestions, generateQuestionsForTypes } from './_lib/generateQuestions.ts'
import { journalFromAudio } from './lib/fromAudio.ts'
import { journalFromVideo } from './lib/fromVideo.ts'
import { CONTEXT_TOKENS_TRIPWIRE, gatherContext, type JournalContext } from './lib/gatherContext.ts'

const typesDescription = `Journal types: ${JournalTypes.join(', ')} (or any custom type with --from-audio)`

function validateFromAudioRequiresTypes(_result: Record<string, unknown>, rawArgs: Args): string | undefined {
  const hasFromAudio = rawArgs['from-audio'] !== undefined || rawArgs['fromAudio'] !== undefined
  const hasTypes = rawArgs['types'] !== undefined
  if (hasFromAudio && !hasTypes && rawArgs['split'] === undefined) {
    return '--from-audio requires --types to be specified (e.g. --types "Reflection")'
  }
  return undefined
}

const params = {
  all: Flag.bool('Generate all journals', { short: 'a', default: false }),
  ai: Flag.bool('Generate AI-powered contextual questions', { default: false }),
  inspectInitialContext: Flag.bool('List initial context file paths and exit', { default: false }),
  dryRun: Flag.bool('Show context and AI questions without creating files', { default: false }),
  fromAudio: Flag.string(
    'Path to audio file, or omit path to search Desktop. Use --split to detect types, or supply --types.',
    {
      optional: true,
    },
  ),
  fromVideo: Flag.string(
    'Path to a recorded video journal, or omit path to search Desktop. Files under the Video type.',
    { optional: true },
  ),
  noAutoTag: Flag.bool('Skip automatic tagging from the archived-journal tag corpus', { default: false }),
  noAutoRel: Flag.bool('Skip automatic rel suggestion from the entity graph', { default: false }),
  fresh: Flag.bool('Start over: forget what an earlier run of the recording already produced', { default: false }),
  split: Flag.stringOrBool(
    'Split an audio or video journal into one entry per type: bare --split groups automatically, --split="Health, Faith" extracts those entries plus a remainder',
    { bareValue: 'auto' },
  ),
  types: Flag.stringArray(typesDescription, {
    parse: (val) => val.split(','),
    default: () => ['Mood'],
    schema: z.array(z.string().trim().min(1)).min(1),
  }),
  when: whenNBTime(),
}

type Params = InferParams<typeof params>

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'journal:new': {
      params: Params
      paramsIn: InferParamsInput<typeof params>
      result: { files: string[] } | undefined
    }
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
    const { when, all, ai, inspectInitialContext, dryRun, fromAudio, fromVideo } = args
    const types = args.types

    // Both recordings share organization and filing after the clean pass;
    // video first extracts its audio.
    if (fromVideo !== undefined) {
      // A bare `--from-video` arrives as the string 'true', meaning "find it on
      // the Desktop" rather than naming a file. Same convention --from-audio
      // and --from-srt use.
      const videoPath = typeof fromVideo === 'string' && fromVideo !== 'true' ? fromVideo : undefined
      return await journalFromVideo({
        videoPath,
        when,
        context,
        tasks,
        noAutoTag: args.noAutoTag,
        noAutoRel: args.noAutoRel,
        split: args.split,
        fresh: args.fresh,
      })
    }

    if (fromAudio !== undefined) {
      return journalFromAudio({
        fromAudio,
        when,
        types,
        split: args.split,
        fresh: args.fresh,
        noAutoTag: args.noAutoTag,
        noAutoRel: args.noAutoRel,
        context,
        tasks,
      })
    }

    let journalTypes = types

    // --all overrides everything
    if (all) {
      journalTypes = JournalTypes
    }

    const validTypes = journalTypes.filter((type: string) => {
      if (!JournalTypes.includes(type)) {
        output.log(`WARN: ${type} is not a valid journal type.`)
        return false
      }

      return true
    })

    // Gather AI questions if --ai flag is set
    let aiQuestions: GeneratedQuestion[] = []
    let journalContext: JournalContext | undefined
    if (ai || inspectInitialContext) {
      output.log('Gathering context for AI questions...')
      journalContext = await gatherContext(when.plainDate, when.time)

      output.log(`Context: ${journalContext.documentCount} documents, ~${journalContext.totalTokens} tokens`)
      if (journalContext.totalTokens > CONTEXT_TOKENS_TRIPWIRE) {
        output.log(
          `WARN: context is unusually large (>${CONTEXT_TOKENS_TRIPWIRE} estimated tokens) — check the day window for oversized files`,
        )
      }

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

    const typeQuestions = await Promise.all(
      Array.from(typesToCreate).map(async (journalType: JournalType) => {
        let questions = await createQuestions(journalType, when.plainDate)
        const aiQuestionsForType = aiQuestionsByType.get(journalType)
        if (aiQuestionsForType) {
          const aiQuestionTuples: Question[] = aiQuestionsForType.map((q) => ['EVERY-DAY', 1.0, q])
          questions = [...aiQuestionTuples, ...questions]
        }
        return { type: journalType, questions }
      }),
    )

    // A journal type with no static questions is AI-generated. Under --ai, fill
    // each empty type with at least one goal-linked question (reusing the context
    // gathered above) instead of skipping it. An empty <Type>.md = AI-only type.
    if (ai && journalContext) {
      const emptyTypes = typeQuestions.filter((t) => t.questions.length === 0).map((t) => t.type)
      if (emptyTypes.length > 0) {
        output.log(`Generating goal-based questions for: ${emptyTypes.join(', ')}`)
        const generated = await generateQuestionsForTypes(emptyTypes, journalContext)
        const generatedByType = new Map<JournalType, Question[]>()
        for (const q of generated) {
          const tuple: Question = ['EVERY-DAY', 1.0, `(AI) ${q.question}`]
          const tuples = generatedByType.get(q.type) ?? []
          tuples.push(tuple)
          generatedByType.set(q.type, tuples)
        }
        for (const t of typeQuestions) {
          const generatedTuples = generatedByType.get(t.type)
          if (generatedTuples && t.questions.length === 0) t.questions = generatedTuples
        }
      }
    }

    const docs = typeQuestions.map(({ type, questions }) => ({
      type,
      doc: JournalDocument.create({ type, date: when, questions }),
    }))

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

    if (context.platform === CommandPlatform.Console) openEditor(files)

    // The paths as the day directory holds them — a host that shows what was filed needs them.
    return CommandResult.success({ files: files.map((f) => path.relative(ddfw.fullDir, f.file)) })
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
