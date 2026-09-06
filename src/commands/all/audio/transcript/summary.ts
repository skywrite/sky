import { mkdir } from 'node:fs/promises'
import * as path from 'node:path'
import { generateText, streamText } from 'ai'
import openEditor from 'open-editor'
import colors from 'picocolors'
import type { OutputHandler } from '#commands/lib/output/OutputHandler.ts'
import type { Prompter } from '#commands/lib/prompt/Prompter.ts'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DIR_OUTPUT } from '#config'
import { normalizeActionItems, type TranscriptActionItem } from '#lib/notebook/actionItems.ts'
import { excludeParties, partyExclusionSet } from '#lib/notebook/enrich/parties.ts'
import { fetchPeopleIndex } from '#lib/service/documents.ts'
import { logAIError } from '#shared/ai/errorLog.ts'
import { extractJson } from '#shared/ai/extractJson.ts'
import { aiModel, aiModelByProfile, ROLES } from '#shared/ai/models.ts'
import { readTextFile, writeTextFile } from '#shared/fs/mod.ts'
import { logger } from '#shared/log.ts'
import { type PersonIndexEntry, profilesPinnedBy } from '#shared/models/Person/subjects.ts'
import { readPromptFile } from '#shared/prompts/load.ts'
import { type RenderInput, renderPromptFile } from '#shared/prompts/mod.ts'
import { isTerminal, readStdin, setRaw } from '#shared/sys/mod.ts'
import { extractTypedTime, labelledTimeRaw } from '#universal/dates/extractTypedTime.ts'
import { resolveTimeField } from './lib/timeField.ts'
import { clockLabel, runOptionsFor, TranscriptRun } from './lib/transcriptRun.ts'
import { extractTypedNameLists } from './lib/typedNameLists.ts'

// -----------------------------------------------------------------------------
// Params & Types
// -----------------------------------------------------------------------------

const params = {
  file: Flag.string('Path to transcript file (alternative to stdin)', {
    short: 'f',
    optional: true,
  }),
  text: Flag.string('Transcript text (alternative to file/stdin, for composition)', {
    optional: true,
    hidden: true,
  }),
  fromAudio: Flag.string(
    'Run full audio pipeline: transcribe, clean, then summarize. Optional path to audio file, or omit to search Desktop.',
    {
      short: 'a',
      optional: true,
    },
  ),
  fromZoomVtt: Flag.string(
    'Run transcript pipeline: clean, then summarize. Optional path to transcript file, or omit to use the newest .vtt on the Desktop.',
    {
      optional: true,
    },
  ),
  fromSrt: Flag.string(
    'Run transcript pipeline: clean, then summarize. Optional path to an .srt transcript, or omit to use the newest .srt on the Desktop.',
    {
      optional: true,
    },
  ),
  fromText: Flag.string(
    'Run transcript pipeline: clean, then summarize. Optional path to a .txt of speaker lines, or omit to use the newest .txt on the Desktop.',
    {
      optional: true,
    },
  ),
  output: Flag.string('Write to specific file path', {
    short: 'o',
    optional: true,
  }),
  save: Flag.bool('Auto-save to Desktop', {
    short: 's',
    default: false,
  }),
  title: Flag.string('Title for the summary', {
    short: 't',
    default: () => 'Transcript Summary',
  }),
  template: Flag.string('Built-in summary template: meeting or audio-message', {
    default: () => 'meeting',
    hidden: true,
  }),
  summaryPrompt: Flag.string('Path to a custom summary prompt file (overrides template)', {
    optional: true,
    hidden: true,
  }),
  extractPrompt: Flag.string('Path to a custom extract prompt file (overrides template)', {
    optional: true,
    hidden: true,
  }),
  fresh: Flag.bool('Start over: forget what an earlier run of this file already produced', {
    default: false,
  }),
  run: Flag.string('Run record key, passed down by the command that owns the run', {
    optional: true,
    hidden: true,
  }),
  when: Flag.string(
    'The start as the caller states it — typed, or changed by hand in a dialog — in notebook time, YYYY-MM-DD HH:MM; the write-up says it and the time field keeps it over a time the transcript mentions',
    { optional: true, hidden: true },
  ),
  clock: Flag.string(
    "The start the file's clock gives — when a recording was made, or when a transcript began — in notebook time, YYYY-MM-DD HH:MM; sky's own reading, passed by a host: the words are resolved against it, and it fills the time field only when they give no time",
    { optional: true, hidden: true },
  ),
}

type Params = InferParams<typeof params>

type Result = {
  /** The run record's key — the sha256 of the source file — for whoever continues the run; null for a paste */
  run: string | null
  outputPath: string | null
  title: string
  time: string | null // PlainDateTime format: YYYY-MM-DDTHH:MM
  durationMinutes: number | null
  medium: string | null // Call medium: Zoom, Phone, Google Meet, etc.
  who: string[] // Attendees - people in the meeting
  rel: string[] // Related - people mentioned but not attending
  actionItems: TranscriptActionItem[] // Structured action-item bullets (meeting template; [] when none)
  summary: string
  body: string // Full markdown output
  cleanedText: string // Input transcript (cleaned if from audio pipeline)
  audioFilePath: string | null // Source audio file path (when --from-audio used)
  transcriptFilePath: string | null // Transcript file that was read, null when pasted in
  from: string | null // For audio-message template
  to: string | null // For audio-message template
}

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'audio:transcript:summary': {
      params: Params
      result: Result
    }
  }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

// The summary IS the meeting notes, so it rides the reasoning role — the registry's
// strongest default — rather than a literal, keeping one swap point at the next model
// bump. Metadata extraction and correction-parsing are lighter and use baseline roles.
const SUMMARY_MODEL = ROLES.reasoning

// No-op until the CLI process family configures logging (see #shared/log.ts).
const log = logger('transcript')

/** Notebook time as the flags take it: YYYY-MM-DD HH:MM, extended hours allowed */
const NOTEBOOK_WHEN = /^\d{4}-\d{2}-\d{2} \d{1,2}:\d{2}$/

const PROMPT_FILES = {
  meeting: {
    summary: new URL('./prompts/transcript-summary.prompt.md', import.meta.url).pathname,
    extract: new URL('./prompts/transcript-summary-extract.prompt.md', import.meta.url).pathname,
  },
  'audio-message': {
    summary: new URL('./prompts/transcript-summary-message.prompt.md', import.meta.url).pathname,
    extract: new URL('./prompts/transcript-summary-extract-message.prompt.md', import.meta.url).pathname,
  },
}

/**
 * Extract a section's content from markdown by header name.
 */
function extractSection(markdown: string, headerName: string): string | null {
  const pattern = new RegExp(`^## ${headerName}\\s*\\n([\\s\\S]*?)(?=^## |$)`, 'mi')
  const match = markdown.match(pattern)
  return match ? match[1].trim() : null
}

/**
 * Convert a string to a URL-safe slug.
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
}

interface ProfileMatches {
  /** Canonical names of the profiles the confirmed names pin, in list order, deduped */
  profiles: string[]
  /** Confirmed names pinning no profile — bare first names, or full names with no profile */
  unmatched: string[]
}

/**
 * Which profiles the person distiller downstream (meeting:new) will write
 * to, by the same rule it applies: a full name pins its profile, a bare
 * name pins none — the analysis step had the contacts list and left it
 * bare. Printed before the corrections prompt so a full name can be typed
 * in. Null when the people index is unavailable, and then nothing is claimed.
 */
async function matchProfiles(names: string[]): Promise<ProfileMatches | null> {
  let index: PersonIndexEntry[]
  try {
    index = await fetchPeopleIndex()
  } catch {
    return null
  }
  const profiles: string[] = []
  const unmatched: string[] = []
  for (const name of names) {
    const pinned = profilesPinnedBy(name, index)
    if (pinned.length === 0) unmatched.push(name)
    for (const entry of pinned) if (!profiles.includes(entry.name)) profiles.push(entry.name)
  }
  return { profiles, unmatched }
}

// -----------------------------------------------------------------------------
// Command
// -----------------------------------------------------------------------------

export default class AudioTranscriptSummaryTask extends Command {
  static override description: CommandDescription = {
    name: 'audio:transcript:summary',
    description: 'Generate a structured summary from a transcript using AI.',
    descriptionLong: [
      'Takes a transcript (from file or stdin) and uses AI to generate',
      'a structured summary including key points, action items, and decisions.',
    ],
    usage: [
      'sky audio:transcript:summary --file input.txt  # Read from file',
      'sky audio:transcript:summary                   # Paste via stdin',
      'sky audio:transcript:summary --from-zoom-vtt   # Clean + summarize newest .vtt on Desktop',
      'sky audio:transcript:summary --from-srt        # Clean + summarize newest .srt on Desktop',
      'sky audio:transcript:summary --from-text       # Clean + summarize newest .txt on Desktop',
    ],
    params,
  }

  async run({ args, context, tasks }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    const {
      file,
      text,
      fromAudio,
      fromZoomVtt,
      fromSrt,
      fromText,
      title,
      output: outputArg,
      save: saveArg,
      template,
      summaryPrompt: summaryPromptPath,
      extractPrompt: extractPromptPath,
      fresh,
      run: runKey,
    } = args
    const runOptions = runOptionsFor(context)
    /** The run record, once the source file is known; null for a paste */
    let run: TranscriptRun | null = null
    const builtin = PROMPT_FILES[template as keyof typeof PROMPT_FILES] ?? PROMPT_FILES.meeting
    const prompts = {
      summary: summaryPromptPath ?? builtin.summary,
      extract: extractPromptPath ?? builtin.extract,
    }

    // Handle pipeline: delegate to clean (audio transcribes first), then summarize
    const transcriptSources = [fromZoomVtt, fromSrt, fromText].filter((flag) => flag !== undefined)
    if (transcriptSources.length > 1) {
      return CommandResult.fail('Use only one of --from-zoom-vtt, --from-srt or --from-text')
    }
    const useAudioPipeline = fromAudio !== undefined
    const useCleanPipeline = useAudioPipeline || transcriptSources.length === 1

    let transcript: string
    let pipelineWho: string[] = []
    let pipelineRel: string[] = []
    let pipelineAudioFilePath: string | null = null
    let pipelineDuration: number | null = null
    let transcriptFilePath: string | null = null

    if (useCleanPipeline) {
      // --from-audio: transcribe → clean. --from-zoom-vtt / --from-srt / --from-text:
      // clean an existing transcript.
      const cleanResult = await tasks.run('audio:transcript:clean', {
        ...(useAudioPipeline
          ? { fromAudio }
          : fromSrt !== undefined
            ? { fromSrt }
            : fromText !== undefined
              ? { fromText }
              : { fromZoomVtt }),
        fresh,
        run: runKey,
      })
      if (!cleanResult.ok || !cleanResult.data) {
        // No prefix: callers (meeting:new, video:new) already label the pipeline failure.
        return CommandResult.fail(cleanResult.message ?? 'Transcript cleaning failed')
      }
      transcript = cleanResult.data.cleanedText
      pipelineWho = cleanResult.data.who
      pipelineRel = cleanResult.data.rel
      pipelineAudioFilePath = cleanResult.data.audioFilePath
      pipelineDuration = cleanResult.data.durationMinutes
      transcriptFilePath = cleanResult.data.transcriptFilePath
      // The cleaner keyed the run by the source file, and cleared it if asked to.
      if (cleanResult.data.run) run = await TranscriptRun.open(cleanResult.data.run, runOptions)
      output.log(`\nExtracted attendees: ${pipelineWho.join(', ') || 'none'}`)
      output.log('Generating summary...\n')
    } else if (text) {
      // Get transcript input (text param > file param > stdin)
      transcript = text
    } else if (file) {
      transcriptFilePath = file
      try {
        transcript = await readTextFile(file)
      } catch (err) {
        return CommandResult.error(err as Error, `Failed to read file: ${file}`)
      }
      run = await TranscriptRun.resolve(runKey, file, runOptions)
      // A record this command keyed itself is its own to start over; one a parent passed down was cleared there.
      if (fresh && !runKey) {
        await run.clear()
        output.log(colors.gray('Starting over.'))
      }
    } else {
      transcript = await this.readMultilineInput(output)
    }

    if (!transcript.trim()) {
      return CommandResult.fail('No transcript content provided')
    }

    log.debug('transcript received', { chars: transcript.length, lines: transcript.split('\n').length })
    output.log(colors.gray(`\nReceived ${transcript.split('\n').length} lines of transcript`))

    // A start the caller states — typed on the command line, or changed by
    // hand in the import dialog — is the meeting's time: the write-up says it,
    // the time field keeps it, and only a correction typed at the check
    // replaces it.
    const statedWhen = args.when?.trim() || null
    if (statedWhen && !NOTEBOOK_WHEN.test(statedWhen)) {
      return CommandResult.fail(`Invalid --when "${statedWhen}" — use notebook time, YYYY-MM-DD HH:MM`)
    }
    // What the file's clock says — a host's reading of when a recording was
    // made or a transcript began, never the person's word. The prompts get it
    // as the fact it is, and it fills the time field only when nothing else does.
    const clockWhen = args.clock?.trim() || null
    if (clockWhen && !NOTEBOOK_WHEN.test(clockWhen)) {
      return CommandResult.fail(`Invalid --clock "${clockWhen}" — use notebook time, YYYY-MM-DD HH:MM`)
    }

    // 2. Load and render summary prompt
    const promptContent = await readPromptFile(prompts.summary)

    const renderInput: RenderInput = {
      context: {
        notebookDate: context.notebookNow.date,
        systemDate: context.systemNow.date,
        notebookTimezone: context.notebookNow.timezone,
        systemTimezone: context.systemNow.timezone,
      },
      // What the caller stated, for the write-up's Time/Date and the extraction; empty when nobody did.
      stated: { when: statedWhen ?? '' },
      // What the file's clock says, as the fact it is: when a recording was made, or when a transcript began.
      clock: useAudioPipeline ? { recorded: clockWhen ?? '', start: '' } : { recorded: '', start: clockWhen ?? '' },
      user: { input: transcript },
    }

    const { output: summaryPrompt } = renderPromptFile(promptContent, 'transcript-summary.prompt.md', renderInput)

    // 3. Generate summary with AI — unless an earlier run of this file already has it.
    output.stage('writeup', 'Writing it up')

    let summary: string
    const keptWriteup = run ? await run.get('writeup') : null
    if (keptWriteup) {
      summary = keptWriteup.data.summary
      output.log(colors.gray(`Write-up from ${clockLabel(keptWriteup.at, runOptions.now())}, reused.`))
      // Shown whole, as the streamed one would have been: it is what the person is about to check.
      output.write(summary + '\n')
    } else {
      // Streamed for the same reason as the analysis call (see clean.ts): a long
      // silent non-streaming socket gets killed by network idle timeouts, and
      // onError is where the real failure cause surfaces.
      let streamError: unknown
      try {
        const stream = streamText({
          ...aiModelByProfile(SUMMARY_MODEL),
          abortSignal: context.signal,
          prompt: summaryPrompt,
          timeout: 20 * 60 * 1000, // 20 min — backstop only; the idle guard fails wedges fast
          onError: ({ error }) => {
            streamError ??= error
          },
        })
        // The write-up appears as it is written — the only progress a model
        // call offers, and the words the person is about to check.
        let streamed = ''
        for await (const delta of stream.textStream) {
          streamed += delta
          output.write(delta)
        }
        if (streamError !== undefined) throw streamError
        output.write('\n')
        summary = streamed
      } catch (err) {
        const error = (streamError ?? err) as Error
        output.error(`AI Error: ${error.message}`)
        await logAIError({ source: 'audio:transcript:summary', stage: 'summary', message: error.message })
        return CommandResult.error(error, `Failed to generate summary: ${error.message}`)
      }
      if (run) await run.put('writeup', { summary })
    }

    log.debug('summary generated', { chars: summary.length })

    // 4. Extract structured metadata with second AI call
    // Shape the extract and correction prompts are asked to return. Every field
    // is optional: the model omits what it can't find, and `time` is passed
    // through verbatim (extended notebook hours are valid — see docs/nbfs.md).
    interface ExtractedMetadata {
      title?: string
      time?: string
      durationMinutes?: number
      medium?: string
      from?: string
      to?: string
      who?: string[]
      rel?: string[]
      actionItems?: unknown // Validated by normalizeActionItems, never trusted as typed
    }

    let extractedTitle: string = 'Untitled'
    let extractedTime: string | null = null
    let extractedDuration: number | null = null
    let extractedMedium: string | null = null
    let extractedWho: string[] = []
    let extractedRel: string[] = []
    let extractedFrom: string | null = null
    let extractedTo: string | null = null
    let extractedActionItems: TranscriptActionItem[] = []
    let finalWho: string[] = []
    let finalRel: string[] = []
    const isMessageTemplate = template === 'audio-message'

    // The fields as an earlier run of this file left them — extracted, and
    // corrected by whatever rounds of the check it got through. The check
    // below still asks, with those on screen, so nothing is retyped.
    const keptExtract = run ? await run.get('extract') : null
    if (keptExtract) {
      const kept = keptExtract.data
      extractedTitle = kept.title
      extractedTime = kept.time
      extractedDuration = kept.durationMinutes
      extractedMedium = kept.medium
      extractedFrom = kept.from
      extractedTo = kept.to
      extractedActionItems = normalizeActionItems(kept.actionItems)
      finalWho = kept.who
      finalRel = kept.rel
      output.log(colors.gray(`Fields from ${clockLabel(keptExtract.at, runOptions.now())}, reused.`))
    } else {
      output.log(colors.cyan('Extracting metadata...'))

      const extractPromptContent = await readPromptFile(prompts.extract)
      const { output: extractPrompt } = renderPromptFile(extractPromptContent, 'transcript-summary-extract.prompt.md', {
        ...renderInput,
        user: { input: summary },
      })

      // Hoisted so the failure warn can carry the payload that failed to parse.
      let extractRaw = ''
      try {
        const result = await generateText({
          ...aiModel('balanced'),
          abortSignal: context.signal,
          prompt: extractPrompt,
          timeout: 20 * 60 * 1000, // 20 min
        })

        extractRaw = result.text

        log.debug('metadata extract response', { raw: extractRaw })

        const extracted = extractJson<ExtractedMetadata>(extractRaw)
        extractedTitle = extracted.title || 'Untitled'
        extractedTime = extracted.time || null
        extractedDuration = extracted.durationMinutes ?? null
        extractedMedium = extracted.medium || null
        extractedRel = Array.isArray(extracted.rel) ? extracted.rel : []
        extractedActionItems = normalizeActionItems(extracted.actionItems)
        if (isMessageTemplate) {
          extractedFrom = extracted.from || null
          extractedTo = extracted.to || null
        } else {
          extractedWho = Array.isArray(extracted.who) ? extracted.who : []
        }
      } catch (err) {
        output.log(colors.yellow('Metadata extraction failed — continuing with defaults'))
        log.warn('metadata extraction failed', { error: err, raw: extractRaw })
        await logAIError({
          source: 'audio:transcript:summary',
          stage: 'extract',
          message: `${(err as Error).message}${extractRaw ? ` — raw head: ${extractRaw.slice(0, 200)}` : ''}`,
        })
      }

      // Duration computed from VTT cue timestamps is exact — prefer it over the
      // model's guess from the summary prose. User corrections below still override.
      if (pipelineDuration !== null) extractedDuration = pipelineDuration

      // Merge who/rel: prefer the analysis step's lists — it phonetically matched names
      // against known contacts (canonical full names), so it's the authoritative source.
      // Fall back to the summary-extracted lists on the paste/file path (no analysis step).
      // Shown in the confirmation box below; user corrections override them.
      finalWho = pipelineWho.length > 0 ? pipelineWho : extractedWho
      finalRel = pipelineRel.length > 0 ? pipelineRel : extractedRel
      // rel: lists people discussed, never the parties — who/from/to already
      // record them. The analysis and extract prompts ask for that split; models
      // leak, so this enforces it. Hand edits to the written file stay sovereign.
      finalRel = excludeParties(finalRel, partyExclusionSet([...finalWho, extractedFrom, extractedTo]))
    }

    // The time field, settled: a stated start is the person's word, the clock
    // is sky's reading, and a time settled at an earlier check stays.
    extractedTime = resolveTimeField({
      time: extractedTime,
      kept: Boolean(keptExtract),
      stated: statedWhen,
      clock: clockWhen,
    })

    // The fields as they stand, kept after extraction and after every round
    // of the check, so a rerun shows the corrected ones.
    const keepFields = async () => {
      if (!run) return
      await run.put('extract', {
        title: extractedTitle,
        time: extractedTime,
        durationMinutes: extractedDuration,
        medium: extractedMedium,
        who: finalWho,
        rel: finalRel,
        from: extractedFrom,
        to: extractedTo,
        actionItems: extractedActionItems,
      })
    }
    if (!keptExtract) await keepFields()

    const finalTitle = title !== 'Transcript Summary' ? title : extractedTitle

    // Extract summary section (different header per template)
    const summarySection = isMessageTemplate
      ? extractSection(summary, 'Summary') || ''
      : extractSection(summary, 'Meeting Summary') || ''

    // Dump summary to /tmp for debugging
    const tmpPath = `/tmp/transcript-summary-${slugify(finalTitle)}.md`
    await writeTextFile(tmpPath, summary)
    output.log(colors.gray(`\nDumped summary to: ${tmpPath}`))

    // The message template's from/to feed no profile distiller; the meeting
    // template's who/rel do, so say up front which profiles they reach.
    let matches = isMessageTemplate ? null : await matchProfiles([...finalWho, ...finalRel])

    // Show extracted metadata for confirmation — and again after each
    // round of corrections, so what is about to be written is on screen.
    const showMetadata = () => {
      output.log(colors.cyan('\n─── Extracted Metadata ───'))
      output.log(colors.white(`  Title:    ${extractedTitle === 'Untitled' ? finalTitle : extractedTitle}`))
      output.log(colors.white(`  Time:     ${extractedTime ?? '(not detected)'}`))
      output.log(colors.white(`  Duration: ${extractedDuration ? `${extractedDuration} min` : '(not detected)'}`))
      output.log(colors.white(`  Medium:   ${extractedMedium ?? '(not detected)'}`))
      if (isMessageTemplate) {
        output.log(colors.white(`  From:     ${extractedFrom ?? '(not detected)'}`))
        output.log(colors.white(`  To:       ${extractedTo ?? '(not detected)'}`))
      } else {
        output.log(colors.white(`  Who:      ${finalWho.length > 0 ? finalWho.join(', ') : '(none)'}`))
      }
      output.log(colors.white(`  Rel:      ${finalRel.length > 0 ? finalRel.join(', ') : '(none)'}`))
      if (matches) {
        output.log(colors.white(`  Profiles: ${matches.profiles.length > 0 ? matches.profiles.join(', ') : '(none)'}`))
        if (matches.unmatched.length > 0) {
          output.log(colors.white(`  No match: ${matches.unmatched.join(', ')}`))
        }
      }
      output.log(colors.cyan('──────────────────────────'))
    }
    showMetadata()

    // Ask for corrections when someone is there to answer, and ask again
    // after each round: a second thought is one more line, not a re-run.
    let rounds = 0
    while (context.prompt.interactive) {
      const corrections = await this.askForCorrections(context.prompt, output, {
        unmatched: (matches?.unmatched.length ?? 0) > 0,
        again: rounds > 0,
      })
      if (!corrections) break
      rounds++
      {
        output.log(colors.cyan('\nParsing corrections...'))

        // An explicitly typed `time:` is read here, not by the model — it can't
        // then normalize an extended hour, roll the date forward, or pick the
        // year for a partial date. Applied before the call so a model failure
        // can't discard it either. When it declines, say so: the AI gets the
        // value, and the user should know a guess is coming.
        const typedTime = extractTypedTime(corrections, context.notebookNow.date)
        if (typedTime) {
          extractedTime = typedTime.value
          if (typedTime.yearInferred) {
            output.log(colors.gray(`  Typed time "${typedTime.raw}" read as ${typedTime.value}`))
          }
        } else {
          const rawTime = labelledTimeRaw(corrections)
          if (rawTime) {
            output.log(
              colors.yellow(
                `  Typed time "${rawTime}" isn't HH:MM, MM-DD HH:MM, or YYYY-MM-DD HH:MM — the AI will interpret it`,
              ),
            )
          }
        }

        // Typed who:/rel: lists are read here for the same reason as time:
        // — the names land verbatim, the model cannot respell or drop them,
        // and a parse failure cannot discard them. A typed list replaces the
        // whole field (the hint says "retype its list"); the AI still sees
        // the full correction text for everything else. Echoed so the exact
        // list about to be written is on screen. The message template keeps
        // its from:/to: contract, so who: stays with the model there.
        const typedLists = extractTypedNameLists(corrections)
        if (typedLists.who && !isMessageTemplate) {
          finalWho = typedLists.who
          output.log(colors.gray(`  Typed who read as: ${finalWho.join(', ') || '(none)'}`))
        }
        if (typedLists.rel) {
          finalRel = typedLists.rel
          output.log(colors.gray(`  Typed rel read as: ${finalRel.join(', ') || '(none)'}`))
        }

        // Use AI to parse corrections - handles any format including comma-separated fields
        // Hoisted so the failure warn can carry the payload that failed to parse.
        let jsonText = ''
        try {
          const peopleFields = isMessageTemplate
            ? `- from: ${extractedFrom ?? 'null'}\n- to: ${extractedTo ?? 'null'}`
            : `- who: ${JSON.stringify(finalWho)}`

          const peopleRules = isMessageTemplate
            ? '- from and to must be strings\n- Only include fields the user explicitly mentioned'
            : '- who and rel must be arrays of strings\n- Only include fields the user explicitly mentioned'

          const parseResult = await generateText({
            ...aiModel('fast'),
            abortSignal: context.signal,
            prompt: `Parse these user corrections for metadata. Extract any fields the user is updating.

Current metadata:
- title: ${extractedTitle}
- time: ${extractedTime ?? 'null'}
- durationMinutes: ${extractedDuration ?? 'null'}
- medium: ${extractedMedium ?? 'null'}
${peopleFields}
- rel: ${JSON.stringify(finalRel)}

Today's date: ${context.notebookNow.date}

User corrections:
${corrections}

Return ONLY a JSON object with the fields that should be updated. Rules:
- time must be in format "YYYY-MM-DD HH:MM" (zero-padded)
- A date given without a year resolves to its most recent occurrence on or before today's
  date. Never invent a year.
- Hours are NOT capped at 23. Notebook time files late-night work under the day it started,
  so "25:30" means 01:30 the next morning and is a deliberate, valid value. Copy such times
  through exactly — never normalize them, never roll the date forward, never report them as
  invalid or ask the user to clarify them.
- durationMinutes must be a number
${peopleRules}
- If the user says "13 mins" or "13 minutes", convert to durationMinutes: 13

Example input: "Time: 2026-01-27 8:44, duration: 13 mins, Medium: Phone"
Example output: {"time": "2026-01-27 08:44", "durationMinutes": 13, "medium": "Phone"}

Example input: "time: 2026-03-31 25:30"
Example output: {"time": "2026-03-31 25:30"}`,
          })

          jsonText = parseResult.text

          log.debug('correction parse result', { raw: jsonText })

          const parsed = extractJson<ExtractedMetadata>(jsonText)

          // Apply parsed corrections
          if (parsed.title) extractedTitle = parsed.title
          if (!typedTime && parsed.time) extractedTime = parsed.time
          if (parsed.durationMinutes !== undefined) extractedDuration = parsed.durationMinutes
          if (parsed.medium) extractedMedium = parsed.medium
          if (isMessageTemplate) {
            if (parsed.from) extractedFrom = parsed.from
            if (parsed.to) extractedTo = parsed.to
          } else {
            if (!typedLists.who && Array.isArray(parsed.who)) finalWho = parsed.who
          }
          if (!typedLists.rel && Array.isArray(parsed.rel)) finalRel = parsed.rel

          // Corrections can move a person into who (or re-add a party to rel);
          // the party rule holds over whatever the lists now say.
          finalRel = excludeParties(finalRel, partyExclusionSet([...finalWho, extractedFrom, extractedTo]))

          output.log(colors.green('Applied corrections.'))
        } catch (err) {
          output.log(colors.yellow(`Failed to parse corrections: ${err}`))
          log.warn('correction parse failed', { error: err, raw: jsonText })
          await logAIError({
            source: 'audio:transcript:summary',
            stage: 'corrections-parse',
            message: `${(err as Error).message}${jsonText ? ` — raw head: ${jsonText.slice(0, 200)}` : ''}`,
          })
        }
        if (!isMessageTemplate) matches = await matchProfiles([...finalWho, ...finalRel])
        await keepFields()
        showMetadata()
      }
    }

    // Recalculate finalTitle after potential corrections
    const correctedTitle = title !== 'Transcript Summary' ? title : extractedTitle

    // 5. Determine output destination
    let outputPath: string | null = null
    const isStandalone = context.compositionDepth === 0

    if (outputArg) {
      outputPath = outputArg
    } else if (saveArg) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const filename = `summary_${timestamp}.md`
      await mkdir(DIR_OUTPUT, { recursive: true })
      outputPath = path.join(DIR_OUTPUT, filename)
    } else if (useCleanPipeline && isStandalone) {
      // Standalone pipeline: save to /tmp and open in VSCode
      outputPath = `/tmp/transcript-summary-${slugify(correctedTitle)}.md`
    }

    const content = `---
title: ${correctedTitle}
date: ${extractedTime?.slice(0, 10) ?? context.notebookNow.date}
time: ${extractedTime ?? 'null'}
duration_minutes: ${extractedDuration ?? 'null'}
---

${summary}
`

    if (outputPath) {
      await writeTextFile(outputPath, content)
      output.log(colors.green(`\nSaved to ${outputPath}`))

      // Open in VSCode when running standalone with a pipeline
      if (useCleanPipeline && isStandalone) {
        openEditor([{ file: outputPath, line: 1 }])
      }
    } else if (isStandalone) {
      // Running from CLI with no output specified - print to stdout
      output.log('\n' + content)
    }

    // Standalone, the summary is the whole run; composed, the parent carries
    // the record on and forgets it when it files.
    if (run && context.compositionDepth === 0) await run.clear()

    return CommandResult.success({
      run: run?.key ?? null,
      outputPath,
      title: correctedTitle,
      time: extractedTime,
      durationMinutes: extractedDuration,
      medium: extractedMedium,
      who: finalWho,
      rel: finalRel,
      actionItems: extractedActionItems,
      summary: summarySection,
      body: summary,
      cleanedText: transcript,
      audioFilePath: pipelineAudioFilePath,
      transcriptFilePath,
      from: extractedFrom,
      to: extractedTo,
    })
  }

  private async readMultilineInput(output: OutputHandler): Promise<string> {
    output.log(colors.cyan('Paste your transcript below.'))
    output.log(colors.cyan('Press Enter twice when done (after pasting). Ctrl+C to cancel.'))
    output.log(colors.gray('─'.repeat(50)))

    const isTTY = isTerminal()

    // Put terminal in raw mode to suppress echo (prevents terminal choking on long pastes)
    if (isTTY) {
      setRaw(true)
    }

    const chunks: string[] = []
    const decoder = new TextDecoder()
    let lastInputTime = Date.now()
    let consecutiveNewlines = 0
    let totalCharsReceived = 0
    let cancelled = false
    let shownReceiving = false

    try {
      while (true) {
        const buf = new Uint8Array(4096)
        const n = await readStdin(buf)
        if (n === null) break

        const now = Date.now()
        const timeSinceLastInput = now - lastInputTime
        lastInputTime = now

        const bytes = buf.subarray(0, n)

        // Check for Ctrl+C (byte 3)
        if (bytes.includes(3)) {
          cancelled = true
          break
        }

        const text = decoder.decode(bytes)
        totalCharsReceived += text.length

        // Show "receiving..." once when we start getting content
        if (!shownReceiving && totalCharsReceived > 10) {
          output.log(colors.gray('  (receiving paste...)'))
          shownReceiving = true
        }

        // In raw mode, Enter sends \r not \n - normalize it
        const normalizedText = text.replace(/\r/g, '\n')

        // Check for manual Enter presses (after a pause) to detect double-enter
        const isManualInput = timeSinceLastInput > 300
        if (isManualInput && normalizedText === '\n') {
          consecutiveNewlines++
          if (consecutiveNewlines >= 2) {
            break
          }
        } else if (normalizedText.trim() !== '') {
          consecutiveNewlines = 0
        }

        chunks.push(normalizedText)
      }
    } finally {
      // Restore terminal mode
      if (isTTY) {
        setRaw(false)
      }
    }

    if (cancelled) {
      output.log(colors.yellow('\nCancelled.'))
      return ''
    }

    // Join and clean up the text
    let fullText = chunks.join('')
    // Remove trailing newlines
    fullText = fullText.replace(/\n+$/, '')

    // Display truncated preview of what was received
    output.log(colors.gray('─'.repeat(50)))
    output.log(colors.green(`Received ${fullText.length.toLocaleString()} characters`))

    if (fullText.length > 300) {
      const head = fullText.slice(0, 150)
      const tail = fullText.slice(-100)
      output.log(colors.gray('\nPreview:'))
      output.log(colors.dim(head))
      output.log(colors.yellow(`\n... (${(fullText.length - 250).toLocaleString()} characters not shown) ...\n`))
      output.log(colors.dim(tail))
    } else {
      output.log(colors.gray('\nContent:'))
      output.log(colors.dim(fullText))
    }
    output.log(colors.gray('─'.repeat(50)))

    return fullText
  }

  /**
   * The corrections line: a typed field, a sentence about what is wrong, or
   * nothing. Null when there is nothing — Enter, or a cancel.
   */
  private async askForCorrections(
    prompt: Prompter,
    output: OutputHandler,
    hints: { unmatched: boolean; again: boolean },
  ): Promise<string | null> {
    const hint = ['e.g., "time: 2026-01-20 14:30" or freeform feedback to improve the summary']
    if (hints.unmatched) {
      hint.push(
        'a name under "No match" reaches no profile — retype its list with the full name, e.g. "rel: Sam Rivera, Jordan"',
      )
    }
    output.log('')
    const answer = await prompt.text({
      message: hints.again ? 'Anything else? (Enter to accept)' : 'Any corrections? (Enter to accept, or type changes)',
      hint,
      placeholder: 'time: …, who: …, rel: …, or what to change',
    })
    return answer ? answer : null
  }
}
