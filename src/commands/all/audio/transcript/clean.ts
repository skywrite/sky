import { mkdir } from 'node:fs/promises'
import * as path from 'node:path'
import { streamText } from 'ai'
import openEditor from 'open-editor'
import colors from 'picocolors'
import { z } from 'zod'
import type { OutputHandler } from '#commands/lib/output/OutputHandler.ts'
import type { Prompter } from '#commands/lib/prompt/Prompter.ts'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DIR_OUTPUT } from '#config'
import { logAIError } from '#shared/ai/errorLog.ts'
import { extractJson } from '#shared/ai/extractJson.ts'
import { aiModelByProfile, ROLES } from '#shared/ai/models.ts'
import { readTextFile, writeTextFile } from '#shared/fs/mod.ts'
import { logger } from '#shared/log.ts'
import { type RenderInput, renderPromptFile } from '#shared/prompts/mod.ts'
import { isTerminal, readStdin, setRaw } from '#shared/sys/mod.ts'
import { applyCorrections, type DropReason } from './lib/applyCorrections.ts'
import { dedupeIssues } from './lib/dedupeIssues.ts'
import { desktopFilesByExt } from './lib/desktopFiles.ts'
import { fetchOrgs, fetchPeople, fetchProjects } from './lib/entityLists.ts'
import {
  applyRulings,
  buildRulings,
  capForPrompt,
  GLOSSARY_FILE,
  loadGlossary,
  renderGlossary,
  saveGlossary,
  touchLastSeen,
} from './lib/glossary.ts'
import { isRtf, stampedDurationMinutes, turnStamps } from './lib/plainText.ts'
import SRT from './lib/SRT/mod.ts'
import ZoomVTT from './lib/ZoomVTT/mod.ts'

// -----------------------------------------------------------------------------
// Params & Types
// -----------------------------------------------------------------------------

const params = {
  file: Flag.string('Path to transcript file (alternative to stdin)', {
    short: 'f',
    optional: true,
  }),
  fromAudio: Flag.string(
    'Run audio pipeline: transcribe first, then clean. Optional path to audio file, or omit to search Desktop.',
    {
      short: 'a',
      optional: true,
    },
  ),
  fromZoomVtt: Flag.string(
    'Clean an existing transcript file (skip transcription). Optional path, or omit to use the newest .vtt on the Desktop.',
    {
      optional: true,
    },
  ),
  fromSrt: Flag.string(
    'Clean an existing .srt transcript (skip transcription). Optional path, or omit to use the newest .srt on the Desktop.',
    {
      optional: true,
    },
  ),
  fromText: Flag.string(
    'Clean an existing plain-text transcript (skip transcription). Optional path to a .txt of speaker lines, or omit to use the newest .txt on the Desktop.',
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
  title: Flag.string('Title for the cleaned transcript', {
    short: 't',
    default: () => 'Transcript',
  }),
}

type Params = InferParams<typeof params>

type Result = {
  outputPath: string | null
  cleanedText: string
  appliedCount: number
  skippedCount: number
  summary: string
  who: string[]
  rel: string[]
  audioFilePath: string | null
  /** Transcript file that was read, null when the transcript was pasted in */
  transcriptFilePath: string | null
  /** Length from cue timestamps (VTT/SRT, exact) or --from-text turn stamps (last turn's start, rounded up); null when the input carried neither */
  durationMinutes: number | null
}

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'audio:transcript:clean': {
      params: Params
      result: Result
    }
  }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

const ANALYSIS_PROMPT_FILE = new URL('./prompts/transcript-analysis.prompt.md', import.meta.url).pathname

// Analysis runs on the raw transcript and sets the quality ceiling for the
// notes built on it, so it rides the reasoning role — the registry's strongest default.
// Re-pin to a literal profile here if `reasoning` is ever moved down-tier for cost.
const TRANSCRIPT_MODEL = ROLES.reasoning

// No-op until the CLI process family configures logging (see #shared/log.ts).
const log = logger('transcript')

// Zod schema for structured AI response
const TranscriptIssueSchema = z.object({
  issues: z.array(
    z.object({
      type: z
        .enum(['filler', 'stutter', 'false_start', 'unclear', 'technical', 'name', 'inaudible', 'crosstalk'])
        .catch('unclear'),
      confidence: z.enum(['high', 'medium', 'low']),
      occurrences: z.number().int().positive().catch(1).default(1),
      originalText: z.string(),
      contexts: z.array(z.string()).catch([]).default([]),
      suggestedFix: z.string().nullish(),
      options: z.array(z.string()).nullish(),
    }),
  ),
  summary: z.string(),
  who: z.array(z.string()).default([]).describe('People who are present/participating in the conversation'),
  rel: z.array(z.string()).default([]).describe('People who are discussed/mentioned but not present'),
})

type TranscriptIssue = z.infer<typeof TranscriptIssueSchema>['issues'][number]

/** "(N instances)" when issues cover more instances than entries, else empty. */
function instancesSuffix(issues: TranscriptIssue[]): string {
  const total = issues.reduce((sum, issue) => sum + issue.occurrences, 0)
  return total > issues.length ? ` (${total} instances)` : ''
}

/** Terminal labels for corrections applyCorrections() could not land. */
const DROP_LABELS: Record<DropReason, string> = {
  'not-found': 'not found in transcript',
  conflict: 'a different fix already applied for this text',
  'too-short': 'too short to replace safely',
}

interface UserCorrection {
  issueIndex: number
  originalText: string
  correction: string
  /** Instances behind this entry — the correction phase must hit them all. */
  occurrences: number
  action: 'accept' | 'custom' | 'skip'
}

/** What kind of problem an issue is, in plain words. */
function issueTypeLabel(type: TranscriptIssue['type']): string {
  switch (type) {
    case 'unclear':
      return 'Unclear word'
    case 'technical':
      return 'Technical term'
    case 'name':
      return 'Name spelling'
    case 'inaudible':
      return 'Inaudible'
    case 'crosstalk':
      return 'Crosstalk'
    case 'filler':
      return 'Filler'
    case 'stutter':
      return 'Stutter'
    case 'false_start':
      return 'False start'
    default:
      return String(type)
  }
}

// -----------------------------------------------------------------------------
// Command
// -----------------------------------------------------------------------------

export default class AudioTranscriptCleanTask extends Command {
  static override description: CommandDescription = {
    name: 'audio:transcript:clean',
    description: 'Clean up raw transcript by fixing transcription errors with AI-assisted Q&A.',
    descriptionLong: [
      'Takes a raw transcript (pasted or from file), uses AI to identify transcription errors',
      '(unclear words, technical terms), asks interactive questions to clarify,',
      'then outputs the corrected transcript.',
      '',
      'NOTE: This task only fixes transcription errors. It does NOT add formatting,',
      'speaker labels, or structural changes.',
    ],
    usage: [
      'sky audio:transcript:clean                    # Paste transcript via stdin',
      'sky audio:transcript:clean --file input.txt  # Read from file',
      'sky audio:transcript:clean --from-zoom-vtt   # Clean newest .vtt on Desktop',
      'sky audio:transcript:clean --from-srt        # Clean newest .srt on Desktop',
      'sky audio:transcript:clean --from-text       # Clean newest .txt on Desktop',
      'sky audio:transcript:clean --title "Meeting" # Set output title',
    ],
    params,
  }

  async run({ args, context, tasks }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    const { file, fromAudio, fromZoomVtt, fromSrt, fromText, title, output: outputArg, save: saveArg } = args

    // Handle --from-audio: transcribe first, then clean
    const useAudioPipeline = fromAudio !== undefined
    // Handle --from-zoom-vtt / --from-srt / --from-text: clean an existing transcript
    // file (skip transcription). Each flag owns its format end-to-end: the bare-flag
    // Desktop search only matches that extension (a stray .srt can never shadow the
    // meeting .vtt, or vice versa), and --from-srt / --from-text refuse content of
    // any other format outright.
    const transcriptSources = [fromZoomVtt, fromSrt, fromText].filter((flag) => flag !== undefined)
    if (transcriptSources.length > 1) {
      return CommandResult.fail('Use only one of --from-zoom-vtt, --from-srt or --from-text')
    }
    const audioFilePath = typeof fromAudio === 'string' && fromAudio !== 'true' ? fromAudio : undefined
    const useTranscriptFile = transcriptSources.length === 1

    // 1. Get transcript input
    let transcript: string
    let audioSourcePath: string | null = null
    let transcriptSourcePath: string | null = null

    if (useAudioPipeline) {
      output.log('Starting audio transcription...\n')

      const createArgs: Record<string, unknown> = { save: true, delete: false }
      if (audioFilePath) {
        createArgs.file = audioFilePath
      }
      const createResult = await tasks.run('audio:transcript:create', createArgs)
      if (!createResult.ok || !createResult.data) {
        return CommandResult.fail(`Transcription failed: ${createResult.message}`)
      }
      const transcriptPath = createResult.data.outputPath
      audioSourcePath = createResult.data.inputFile
      if (!transcriptPath) {
        return CommandResult.fail('Transcription did not save to file')
      }
      transcriptSourcePath = transcriptPath
      output.log(`Saved transcript: ${transcriptPath}\n`)

      try {
        transcript = await readTextFile(transcriptPath)
      } catch (err) {
        return CommandResult.error(err as Error, `Failed to read transcript: ${transcriptPath}`)
      }
    } else if (useTranscriptFile) {
      const wantSrt = fromSrt !== undefined
      const wantText = fromText !== undefined
      const flagValue = wantSrt ? fromSrt : wantText ? fromText : fromZoomVtt
      const ext = wantSrt ? '.srt' : wantText ? '.txt' : '.vtt'
      let transcriptPath: string
      if (typeof flagValue === 'string' && flagValue !== 'true') {
        transcriptPath = flagValue
      } else {
        const found = await desktopFilesByExt([ext])
        if (found.length === 0) {
          return CommandResult.fail(`No ${ext} file found on Desktop. Please specify a transcript file path.`)
        }
        if (found.length > 1) {
          output.log(colors.gray(`${found.length} ${ext} files on Desktop, using newest`))
        }
        transcriptPath = found[0].path
      }
      // --from-text owns .txt and nothing else: a transcript that arrived wrapped
      // (.rtf, .docx — a notetaker paste saved from TextEdit or Word) is refused,
      // not unwrapped. Converting it is a one-liner on the user's side.
      if (wantText && path.extname(transcriptPath).toLowerCase() !== '.txt') {
        return CommandResult.fail(
          `--from-text requires a .txt file, got: ${path.basename(transcriptPath)} — convert it first: textutil -convert txt "${transcriptPath}"`,
        )
      }
      transcriptSourcePath = transcriptPath
      output.log(colors.cyan(`Using transcript: ${path.basename(transcriptPath)}`))
      try {
        transcript = await readTextFile(transcriptPath)
      } catch (err) {
        return CommandResult.error(err as Error, `Failed to read transcript: ${transcriptPath}`)
      }
      // --from-srt promises an SRT; anything else fails here rather than being
      // quietly parsed as whatever the content sniff below decides it is.
      if (wantSrt && !SRT.isSrt(transcript)) {
        const why = ZoomVTT.isVtt(transcript) ? 'is a WebVTT file — use --from-zoom-vtt' : 'is not an SRT transcript'
        return CommandResult.fail(`--from-srt: ${path.basename(transcriptPath)} ${why}`)
      }
      // --from-text promises speaker lines: cue formats have their own flags, and
      // RTF renamed to .txt is still RTF.
      if (wantText) {
        const why = ZoomVTT.isVtt(transcript)
          ? 'is a WebVTT file — use --from-zoom-vtt'
          : SRT.isSrt(transcript)
            ? 'is an SRT file — use --from-srt'
            : isRtf(transcript)
              ? 'is RTF, not plain text — convert it to .txt first (textutil -convert txt)'
              : null
        if (why !== null) {
          return CommandResult.fail(`--from-text: ${path.basename(transcriptPath)} ${why}`)
        }
      }
    } else if (file) {
      transcriptSourcePath = file
      try {
        transcript = await readTextFile(file)
      } catch (err) {
        return CommandResult.error(err as Error, `Failed to read file: ${file}`)
      }
    } else {
      transcript = await this.readMultilineInput(output)
    }

    if (!transcript.trim()) {
      return CommandResult.fail('No transcript content provided')
    }

    log.debug('transcript received', { chars: transcript.length, lines: transcript.split('\n').length })

    // Cue-based input (any path: file, Desktop, or paste): parse to structure and
    // feed the models compact turns instead of raw cues — drops the cue-number and
    // timestamp overhead (25-30% of a VTT, over half of an SRT) and merges related
    // cues. Duration comes from cue timestamps exactly.
    //
    // VTT is checked first because it announces itself with a header; SRT has none,
    // so its sniff is structural and deliberately declines anything WEBVTT-headed.
    let cueDurationMinutes: number | null = null
    if (ZoomVTT.isVtt(transcript)) {
      const vtt = ZoomVTT.parse(transcript)
      if (!vtt.looksLikeZoomDialect) {
        output.log(colors.yellow('Voice tags found — not a Zoom VTT? Speaker detection may be unreliable.'))
      }
      cueDurationMinutes = vtt.durationMinutes
      transcript = vtt.toTurnText()
      output.log(colors.gray(`Zoom VTT: ${vtt.cues.length} cues → ${vtt.turns.length} speaker turns`))
    } else if (SRT.isSrt(transcript)) {
      const srt = SRT.parse(transcript)
      const turns = srt.turns()
      cueDurationMinutes = srt.durationMinutes
      transcript = srt.toTurnText()
      const how = srt.speakers.length > 0 ? `${srt.speakers.length} speakers` : 'no speaker labels — split on pauses'
      output.log(colors.gray(`SRT: ${srt.cues.length} cues → ${turns.length} turns (${how})`))
    } else if (fromText !== undefined) {
      // Already the turn text the parsers above produce, so it passes through
      // untouched; the stamps only give the length.
      const stamps = turnStamps(transcript)
      cueDurationMinutes = stampedDurationMinutes(stamps)
      output.log(colors.gray(`Plain text: ${stamps.length} stamped turns`))
    }

    output.log(colors.gray(`\nReceived ${transcript.split('\n').length} lines of transcript`))

    // 2. Fetch known entity names (people, orgs, projects) for matching
    output.log(colors.gray('Fetching known contacts, organizations, and projects...'))
    const knownPeopleFromGraph = await fetchPeople(context.notebookNow.date)
    const knownOrgsFromGraph = await fetchOrgs()
    const knownProjects = await fetchProjects()

    // Also fetch recently created people (last 7 days) via person:list:last
    let recentlyCreatedPeople = ''
    if (tasks) {
      const recentResult = await tasks.run('person:list:last', { days: 7 })
      if (recentResult.ok && recentResult.data) {
        recentlyCreatedPeople = recentResult.data.people.map((p) => `${p.name} (new)`).join('\n')
      }
    }

    // Merge people lists
    const knownPeople = [knownPeopleFromGraph, recentlyCreatedPeople].filter(Boolean).join('\n')

    // Use orgs for name matching too (helps with "Atlus" -> "Atlas" etc.)
    const knownOrgs = knownOrgsFromGraph

    if (knownPeople) {
      output.log(colors.gray(`Loaded ${knownPeople.split('\n').length} contacts for name matching`))
    }
    if (knownOrgs) {
      output.log(colors.gray(`Loaded ${knownOrgs.split('\n').length} organizations for name matching`))
    }
    if (knownProjects) {
      output.log(colors.gray(`Loaded ${knownProjects.split('\n').length} projects for name matching`))
    }

    // User glossary: rulings from past reviews, corrected at HIGH confidence and
    // never re-asked. Null means the file is malformed — never overwrite it then.
    const glossary = await loadGlossary()
    let glossaryTouched = 0
    let glossaryCap = null as ReturnType<typeof capForPrompt> | null
    if (glossary === null) {
      output.log(colors.yellow(`Glossary unreadable — fix or delete ${GLOSSARY_FILE} (new rulings won't be saved)`))
    } else if (glossary.entries.length > 0) {
      glossaryTouched = touchLastSeen(glossary, transcript, context.notebookNow.date)
      glossaryCap = capForPrompt(glossary)
      const counts =
        glossaryCap.rendered < glossaryCap.total
          ? `${glossaryCap.total} glossary rulings (rendered ${glossaryCap.rendered})`
          : `${glossaryCap.total} glossary rulings`
      output.log(colors.gray(`Loaded ${counts}`))
    }

    // 3. Load and render analysis prompt
    const analysisPromptContent = await readTextFile(ANALYSIS_PROMPT_FILE)

    const renderInput: RenderInput = {
      context: {
        notebookDate: context.notebookNow.date,
        systemDate: context.systemNow.date,
        notebookTimezone: context.notebookNow.timezone,
        systemTimezone: context.systemNow.timezone,
      },
      user: {
        input: transcript,
        knownPeople,
        knownOrgs,
        knownProjects,
        glossary: glossaryCap ? renderGlossary(glossaryCap.capped) : '(none yet)',
      },
    }

    const { output: analysisPrompt } = renderPromptFile(
      analysisPromptContent,
      'transcript-analysis.prompt.md',
      renderInput,
    )

    // 4. AI Analysis
    output.stage('names', 'Checking names')

    let analysis: z.infer<typeof TranscriptIssueSchema>
    // Streamed because a long analysis is minutes of silence as a non-streaming
    // request — idle sockets get killed by network timeouts; SSE bytes keep it
    // alive and put it under the provider's stream idle guard. onError captures
    // the real cause: the SDK's result promises reject with a generic
    // NoOutputGeneratedError (mirrors ChatEngine).
    let streamError: unknown
    try {
      // Use streamText + manual JSON parsing instead of generateObject
      // because generateObject's tool mode has issues with Anthropic
      const jsonPrompt = analysisPrompt + '\n\nRespond with ONLY valid JSON, no markdown code fences.'
      const stream = streamText({
        ...aiModelByProfile(TRANSCRIPT_MODEL),
        abortSignal: context.signal,
        prompt: jsonPrompt,
        timeout: 20 * 60 * 1000, // 20 min — backstop only; the idle guard fails wedges fast
        onError: ({ error }) => {
          streamError ??= error
        },
      })
      const text = await stream.text
      if (streamError !== undefined) throw streamError

      analysis = TranscriptIssueSchema.parse(extractJson(text))
    } catch (err) {
      const error = (streamError ?? err) as Error & { text?: string; cause?: unknown }
      output.error(`AI Error: ${error.message}`)
      if (error.text) output.error(`Response text: ${error.text}`)
      if (error.cause) output.error(`Cause: ${JSON.stringify(error.cause, null, 2)}`)
      await logAIError({
        source: 'audio:transcript:clean',
        stage: 'analysis',
        message: `${error.message}${error.text ? ` — response head: ${error.text.slice(0, 200)}` : ''}`,
      })
      return CommandResult.error(error, `Failed to analyze transcript: ${error.message}`)
    }

    // The contract asks for one issue per distinct problem, but models leak
    // per-instance duplicates — merge them so one answer covers every occurrence.
    const rawIssueCount = analysis.issues.length
    analysis.issues = dedupeIssues(analysis.issues)
    if (analysis.issues.length < rawIssueCount) {
      output.log(colors.gray(`Merged ${rawIssueCount - analysis.issues.length} duplicate issues`))
    }

    // Separate high-confidence (auto-apply) from medium/low (need review)
    const autoFixIssues = analysis.issues.filter((i) => i.confidence === 'high')
    const reviewIssues = analysis.issues.filter((i) => i.confidence !== 'high')

    output.log(colors.gray(`Summary: ${analysis.summary}\n`))

    // Display extracted people
    if (analysis.who.length > 0) {
      output.log(colors.cyan(`Participants (who): `) + analysis.who.join(', '))
    }
    if (analysis.rel.length > 0) {
      output.log(colors.cyan(`Mentioned (rel): `) + analysis.rel.join(', '))
    }
    if (analysis.who.length > 0 || analysis.rel.length > 0) {
      output.log('')
    }

    if (autoFixIssues.length > 0) {
      output.log(
        colors.green(`Auto-fixing ${autoFixIssues.length} high-confidence issues${instancesSuffix(autoFixIssues)}`),
      )
    }
    if (reviewIssues.length > 0) {
      output.log(colors.yellow(`${reviewIssues.length} issues need your review${instancesSuffix(reviewIssues)}`))
    }
    if (autoFixIssues.length === 0 && reviewIssues.length === 0) {
      output.log(colors.green('No issues found! Transcript looks clean.'))
    }

    // 5. Review of the medium/low confidence issues, by whoever is there
    if (reviewIssues.length > 0 && context.prompt.interactive) {
      output.stage('names', 'Checking names', `${reviewIssues.length} to check`)
    }
    const reviewCorrections = await this.reviewIssues(context.prompt, reviewIssues)

    // Persist the user's rulings, plus lastSeen touches from this transcript,
    // so future runs stop asking about settled terms.
    if (glossary !== null) {
      const rulings = buildRulings(reviewIssues, reviewCorrections)
      if (rulings.length > 0) applyRulings(glossary, rulings, context.notebookNow.date)
      if (rulings.length > 0 || glossaryTouched > 0) {
        const changes = [
          ...(rulings.length > 0 ? [`${rulings.length} rulings`] : []),
          ...(glossaryTouched > 0 ? [`${glossaryTouched} seen`] : []),
        ]
        try {
          await saveGlossary(glossary)
          output.log(colors.gray(`Glossary updated (${changes.join(', ')}): ${GLOSSARY_FILE}`))
        } catch (err) {
          output.error(`Failed to save glossary: ${(err as Error).message}`)
        }
      }
    }

    // Auto-accept all high-confidence fixes
    const autoCorrections: UserCorrection[] = autoFixIssues.map((issue, i) => ({
      issueIndex: i,
      originalText: issue.originalText,
      correction: issue.suggestedFix || '',
      occurrences: issue.occurrences,
      action: 'accept' as const,
    }))

    const corrections = [...reviewCorrections, ...autoCorrections]

    // 6. Apply corrections (deterministic find→replace — see lib/applyCorrections.ts
    // for why this must never go back to an AI rewrite)
    output.log(colors.cyan('\nApplying corrections...'))

    const applyResult = applyCorrections(
      transcript,
      corrections
        .filter((c) => c.action !== 'skip')
        .map(({ originalText, correction, occurrences }) => ({ originalText, correction, occurrences })),
    )
    const cleanedTranscript = applyResult.text

    if (applyResult.applied.length > 0) {
      const suffix =
        applyResult.totalReplacements > applyResult.applied.length
          ? ` (${applyResult.totalReplacements} replacements)`
          : ''
      output.log(colors.green(`Applied ${applyResult.applied.length} corrections${suffix}`))
      for (const entry of applyResult.applied) {
        if (entry.replaced !== entry.occurrences) {
          output.log(
            colors.gray(
              `  "${entry.originalText}": replaced ${entry.replaced}× (analysis expected ${entry.occurrences})`,
            ),
          )
        }
      }
    }
    for (const entry of applyResult.dropped) {
      const fix = entry.correction ? ` → "${entry.correction}"` : ''
      output.log(colors.yellow(`  Dropped (${DROP_LABELS[entry.reason]}): "${entry.originalText}"${fix}`))
    }

    // 7. Determine output destination
    let outputPath: string | null = null
    const isStandalone = context.compositionDepth === 0

    if (outputArg) {
      outputPath = outputArg
    } else if (saveArg) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const filename = `transcript_${timestamp}.md`
      await mkdir(DIR_OUTPUT, { recursive: true })
      outputPath = path.join(DIR_OUTPUT, filename)
    } else if (useAudioPipeline || useTranscriptFile) {
      // Pipeline runs always land in /tmp: standalone for the user to open,
      // composed (meeting:new) as insurance — a failure downstream must not
      // lose the interactive review baked into the cleaned text.
      const slug = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 50)
      outputPath = `/tmp/transcript-clean-${slug}.md`
    }

    const appliedCount = applyResult.applied.length
    const skippedCount = corrections.length - appliedCount

    // Format people arrays for YAML (use flow style for compact output)
    const whoYaml = analysis.who.length > 0 ? `[${analysis.who.map((n) => `"${n}"`).join(', ')}]` : '[]'
    const relYaml = analysis.rel.length > 0 ? `[${analysis.rel.map((n) => `"${n}"`).join(', ')}]` : '[]'

    const content = `---
title: ${title}
date: ${context.notebookNow.date}
who: ${whoYaml}
rel: ${relYaml}
corrections_applied: ${appliedCount}
corrections_skipped: ${skippedCount}
---

${cleanedTranscript}
`

    if (outputPath) {
      await writeTextFile(outputPath, content)
      if (isStandalone) {
        output.log(colors.green(`\nSaved to ${outputPath}`))
      } else {
        output.log(colors.gray(`\nDumped cleaned transcript to: ${outputPath}`))
      }

      // Open in VSCode when running standalone with a pipeline
      if ((useAudioPipeline || useTranscriptFile) && isStandalone) {
        openEditor([{ file: outputPath, line: 1 }])
      }
    }

    return CommandResult.success({
      outputPath,
      cleanedText: cleanedTranscript,
      appliedCount,
      skippedCount,
      summary: analysis.summary,
      who: analysis.who,
      rel: analysis.rel,
      audioFilePath: audioSourcePath,
      transcriptFilePath: transcriptSourcePath,
      durationMinutes: cueDurationMinutes,
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
   * The issues the analysis was unsure about, put to whoever is there as one
   * review. A headless run gets no review: the high-confidence fixes still
   * apply, and nothing else changes.
   */
  private async reviewIssues(prompt: Prompter, issues: TranscriptIssue[]): Promise<UserCorrection[]> {
    if (issues.length === 0 || !prompt.interactive) return []

    const answers = await prompt.form({
      title: 'Interactive Review',
      intro: 'Pick the right spelling for each one. Your answers are remembered.',
      items: issues.map((issue, i) => ({
        id: String(i),
        label: issueTypeLabel(issue.type),
        problem: issue.originalText,
        contexts: issue.contexts,
        occurrences: issue.occurrences,
        suggestion: issue.suggestedFix ?? undefined,
        alternatives: issue.options ?? [],
      })),
    })
    if (!answers) return []

    // An item without an answer was never reached — the review was quit early.
    const corrections: UserCorrection[] = []
    for (let i = 0; i < issues.length; i++) {
      const answer = answers[String(i)]
      if (!answer) continue
      const issue = issues[i]
      corrections.push({
        issueIndex: i,
        originalText: issue.originalText,
        correction: answer.action === 'skip' ? '' : answer.value,
        occurrences: issue.occurrences,
        action: answer.action,
      })
    }
    return corrections
  }
}
