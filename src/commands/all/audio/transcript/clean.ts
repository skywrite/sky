import * as path from 'node:path'
import { generateText } from 'ai'
import { aiModelByProfile } from '#shared/ai/models.ts'
import { z } from 'zod'
import * as p from '@clack/prompts'
import colors from 'picocolors'
import openEditor from 'open-editor'
import { type RenderInput, renderPromptFile } from '#shared/prompts/mod.ts'
import { exists, readDir, readTextFile, writeTextFile } from '#shared/fs/mod.ts'
import { env, isTerminal, readStdin, setRaw } from '#shared/sys/mod.ts'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import type { OutputHandler } from '#commands/lib/output/OutputHandler.ts'

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
  fromTranscript: Flag.string(
    'Clean an existing transcript file (skip transcription). Optional path, or omit to use the first .vtt on the Desktop.',
    {
      optional: true,
    },
  ),
  output: Flag.string('Write to specific file path', {
    short: 'o',
    optional: true,
  }),
  save: Flag.boolean('Auto-save to Desktop', {
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
const CORRECTION_PROMPT_FILE = new URL('./prompts/transcript-correction.prompt.md', import.meta.url).pathname
const GRAPHQL_URL = 'http://localhost:9999/graphql'

// Analysis + correction run on the raw transcript and set the quality ceiling for the
// notes built on it — pin the strongest profile (not the baseline `reasoning` role).
const TRANSCRIPT_MODEL = 'default-opus-4.8'

async function findFirstVttOnDesktop(): Promise<string | null> {
  const home = env.get('HOME')
  if (!home) return null

  const desktopPath = path.join(home, 'Desktop')
  if (!(await exists(desktopPath))) return null

  const entries: string[] = []
  for await (const entry of readDir(desktopPath)) {
    if (entry.isFile && path.extname(entry.name).toLowerCase() === '.vtt') {
      entries.push(path.join(desktopPath, entry.name))
    }
  }

  if (entries.length === 0) return null

  entries.sort()
  return entries[0]
}

interface PersonWithScore {
  name: string
  score: number
  lastInteraction: string | null
}

interface OrgWithScore {
  name: string
  score: number
  lastInteraction: string | null
}

async function fetchRecentPeople(monthsBack = 4): Promise<string> {
  const cutoffDate = new Date()
  cutoffDate.setMonth(cutoffDate.getMonth() - monthsBack)
  const cutoff = cutoffDate.toISOString().slice(0, 10)

  try {
    const response = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: '{ peopleWithScores { name score lastInteraction } }',
      }),
    })

    if (!response.ok) return ''

    const result = await response.json()
    const people: PersonWithScore[] = result.data?.peopleWithScores ?? []

    return people
      .filter((p) => p.lastInteraction && p.lastInteraction > cutoff)
      .sort((a, b) => b.score - a.score)
      .map((p) => `${p.name} (${Math.floor(p.score)})`)
      .join('\n')
  } catch {
    return ''
  }
}

async function fetchTopOrgs(limit = 30): Promise<string> {
  try {
    const response = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: '{ organizationsWithScores { name score lastInteraction } }',
      }),
    })

    if (!response.ok) return ''

    const result = await response.json()
    const orgs: OrgWithScore[] = result.data?.organizationsWithScores ?? []

    return orgs
      .filter((o) => o.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((o) => `${o.name} (${Math.floor(o.score)})`)
      .join('\n')
  } catch {
    return ''
  }
}

// Zod schema for structured AI response
const TranscriptIssueSchema = z.object({
  issues: z.array(
    z.object({
      type: z
        .enum(['filler', 'stutter', 'false_start', 'unclear', 'technical', 'name', 'inaudible', 'crosstalk'])
        .catch('unclear'),
      confidence: z.enum(['high', 'medium', 'low']),
      lineNumber: z.number(),
      originalText: z.string(),
      context: z.string(),
      suggestedFix: z.string().nullish(),
      options: z.array(z.string()).nullish(),
    }),
  ),
  summary: z.string(),
  who: z.array(z.string()).default([]).describe('People who are present/participating in the conversation'),
  rel: z.array(z.string()).default([]).describe('People who are discussed/mentioned but not present'),
})

type TranscriptIssue = z.infer<typeof TranscriptIssueSchema>['issues'][number]

interface UserCorrection {
  issueIndex: number
  originalText: string
  correction: string
  action: 'accept' | 'custom' | 'skip'
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
      'sky audio:transcript:clean --from-transcript # Clean first .vtt on Desktop',
      'sky audio:transcript:clean --title "Meeting" # Set output title',
    ],
    params,
  }

  async run({ args, context, tasks }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    const { file, fromAudio, fromTranscript, title, output: outputArg, save: saveArg } = args

    // Handle --from-audio: transcribe first, then clean
    const useAudioPipeline = fromAudio !== undefined
    const audioFilePath = typeof fromAudio === 'string' && fromAudio !== 'true' ? fromAudio : undefined
    // Handle --from-transcript: clean an existing transcript file (skip transcription)
    const useTranscriptFile = fromTranscript !== undefined

    // 1. Get transcript input
    let transcript: string
    let audioSourcePath: string | null = null

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
      output.log(`Saved transcript: ${transcriptPath}\n`)

      try {
        transcript = await readTextFile(transcriptPath)
      } catch (err) {
        return CommandResult.error(err as Error, `Failed to read transcript: ${transcriptPath}`)
      }
    } else if (useTranscriptFile) {
      const transcriptPath =
        typeof fromTranscript === 'string' && fromTranscript !== 'true' ? fromTranscript : await findFirstVttOnDesktop()
      if (!transcriptPath) {
        return CommandResult.fail('No .vtt file found on Desktop. Please specify a transcript file path.')
      }
      output.log(colors.cyan(`Using transcript: ${path.basename(transcriptPath)}`))
      try {
        transcript = await readTextFile(transcriptPath)
      } catch (err) {
        return CommandResult.error(err as Error, `Failed to read transcript: ${transcriptPath}`)
      }
    } else if (file) {
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

    // TODO: Remove debug file output before merging
    const debugPath = '/tmp/transcript-debug.txt'
    await writeTextFile(
      debugPath,
      `=== TRANSCRIPT DEBUG ===
Length: ${transcript.length} characters
Lines: ${transcript.split('\n').length}

=== RAW CONTENT ===
${transcript}
=== END ===
`,
    )
    output.log(colors.yellow(`[DEBUG] Transcript written to ${debugPath}`))
    // END TODO

    output.log(colors.gray(`\nReceived ${transcript.split('\n').length} lines of transcript`))

    // 2. Fetch known contacts and organizations for name matching
    output.log(colors.gray('Fetching known contacts and organizations...'))
    const knownPeopleFromGraph = await fetchRecentPeople(4)
    const knownOrgsFromGraph = await fetchTopOrgs(30)

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
      },
    }

    const { output: analysisPrompt } = renderPromptFile(
      analysisPromptContent,
      'transcript-analysis.prompt.md',
      renderInput,
    )

    // 4. AI Analysis
    output.log(colors.cyan('\nAnalyzing transcript...'))

    let analysis: z.infer<typeof TranscriptIssueSchema>
    try {
      // Use generateText + manual JSON parsing instead of generateObject
      // because generateObject's tool mode has issues with Anthropic
      const jsonPrompt = analysisPrompt + '\n\nRespond with ONLY valid JSON, no markdown code fences.'
      const result = await generateText({
        ...aiModelByProfile(TRANSCRIPT_MODEL),
        prompt: jsonPrompt,
        maxRetries: 0,
        timeout: 20 * 60 * 1000, // 20 min — long transcripts are slow to analyze
      })

      // Extract JSON from response (strip any markdown fences if present)
      let jsonText = result.text.trim()
      if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
      }

      const parsed = JSON.parse(jsonText)
      analysis = TranscriptIssueSchema.parse(parsed)
    } catch (err) {
      const error = err as Error & { text?: string; cause?: unknown }
      output.error(`AI Error: ${error.message}`)
      if (error.text) output.error(`Response text: ${error.text}`)
      if (error.cause) output.error(`Cause: ${JSON.stringify(error.cause, null, 2)}`)
      return CommandResult.error(error, 'Failed to analyze transcript')
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
      output.log(colors.green(`Auto-fixing ${autoFixIssues.length} high-confidence issues`))
    }
    if (reviewIssues.length > 0) {
      output.log(colors.yellow(`${reviewIssues.length} issues need your review`))
    }
    if (autoFixIssues.length === 0 && reviewIssues.length === 0) {
      output.log(colors.green('No issues found! Transcript looks clean.'))
    }

    // 5. Interactive Q&A loop (only for medium/low confidence issues)
    const reviewCorrections = await this.interactiveCorrection(output, reviewIssues)

    // Auto-accept all high-confidence fixes
    const autoCorrections: UserCorrection[] = autoFixIssues.map((issue, i) => ({
      issueIndex: i,
      originalText: issue.originalText,
      correction: issue.suggestedFix || '',
      action: 'accept' as const,
    }))

    const corrections = [...reviewCorrections, ...autoCorrections]

    // 6. Apply corrections using AI
    const correctionPromptContent = await readTextFile(CORRECTION_PROMPT_FILE)

    const correctionInput: RenderInput = {
      context: {
        notebookDate: context.notebookNow.date,
        systemDate: context.systemNow.date,
        notebookTimezone: context.notebookNow.timezone,
        systemTimezone: context.systemNow.timezone,
      },
      user: {
        input: transcript,
        corrections: JSON.stringify(
          corrections.filter((c) => c.action !== 'skip'),
          null,
          2,
        ),
      },
    }

    const { output: correctionPrompt } = renderPromptFile(
      correctionPromptContent,
      'transcript-correction.prompt.md',
      correctionInput,
    )

    output.log(colors.cyan('\nApplying corrections and formatting...'))

    let cleanedTranscript: string
    try {
      const result = await generateText({
        ...aiModelByProfile(TRANSCRIPT_MODEL),
        messages: [{ role: 'user', content: correctionPrompt }],
        maxRetries: 0,
        timeout: 20 * 60 * 1000, // 20 min — rewriting a long transcript is slow
      })
      cleanedTranscript = result.text
    } catch (err) {
      return CommandResult.error(err as Error, 'Failed to apply corrections')
    }

    // 7. Determine output destination
    let outputPath: string | null = null
    const isStandalone = context.compositionDepth === 0

    if (outputArg) {
      outputPath = outputArg
    } else if (saveArg) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const filename = `transcript_${timestamp}.md`
      const home = env.get('HOME')
      if (!home) {
        return CommandResult.error(new Error('HOME not set'), 'Could not determine home directory')
      }
      outputPath = path.join(home, 'Desktop', filename)
    } else if ((useAudioPipeline || useTranscriptFile) && isStandalone) {
      // Standalone pipeline: save to /tmp and open in VSCode
      const slug = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 50)
      outputPath = `/tmp/transcript-clean-${slug}.md`
    }

    const appliedCount = corrections.filter((c) => c.action !== 'skip').length
    const skippedCount = corrections.filter((c) => c.action === 'skip').length

    // Format people arrays for YAML (use flow style for compact output)
    const whoYaml = analysis.who.length > 0 ? `[${analysis.who.map((n) => `"${n}"`).join(', ')}]` : '[]'
    const relYaml = analysis.rel.length > 0 ? `[${analysis.rel.map((n) => `"${n}"`).join(', ')}]` : '[]'

    const content = `---
title: ${title}
date: ${new Date().toISOString().slice(0, 10)}
who: ${whoYaml}
rel: ${relYaml}
corrections_applied: ${appliedCount}
corrections_skipped: ${skippedCount}
---

${cleanedTranscript}
`

    if (outputPath) {
      await writeTextFile(outputPath, content)
      output.log(colors.green(`\nSaved to ${outputPath}`))

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

  private async interactiveCorrection(output: OutputHandler, issues: TranscriptIssue[]): Promise<UserCorrection[]> {
    const corrections: UserCorrection[] = []

    if (issues.length === 0) {
      return corrections
    }

    p.intro(colors.bold('Interactive Review'))

    for (let i = 0; i < issues.length; i++) {
      const issue = issues[i]

      // Build context display
      const issueLabel = this.getIssueTypeLabel(issue.type)
      const contextLines = [
        '',
        colors.dim(`─── Issue ${i + 1} of ${issues.length} ───`),
        '',
        `${issueLabel}`,
        '',
        colors.dim('Context:'),
        `  ${issue.context}`,
        '',
        colors.dim('Problem:'),
        `  ${colors.red(issue.originalText)}`,
      ]

      if (issue.suggestedFix) {
        contextLines.push('')
        contextLines.push(colors.dim('AI Suggestion:'))
        contextLines.push(`  ${colors.green(issue.suggestedFix)}`)
      }

      // Log context
      output.log(contextLines.join('\n'))

      // Build options for select
      const options: { value: string; label: string; hint?: string }[] = []

      // Add suggestion as first option if available
      if (issue.suggestedFix) {
        options.push({
          value: `__accept__:${issue.suggestedFix}`,
          label: issue.suggestedFix,
          hint: 'AI suggestion',
        })
      }

      // Add alternative options
      if (issue.options && issue.options.length > 0) {
        for (const opt of issue.options) {
          if (opt !== issue.suggestedFix) {
            options.push({
              value: `__option__:${opt}`,
              label: opt,
              hint: 'alternative',
            })
          }
        }
      }

      // Always add custom and skip options
      options.push({
        value: '__custom__',
        label: 'Enter custom text...',
        hint: 'type your own',
      })

      options.push({
        value: '__skip__',
        label: 'Skip this issue',
        hint: 'leave unchanged',
      })

      options.push({
        value: '__quit__',
        label: 'Quit review',
        hint: 'stop reviewing',
      })

      const selection = await p.select({
        message: 'Select correction:',
        options,
      })

      // Handle cancellation
      if (p.isCancel(selection)) {
        p.cancel('Review cancelled')
        break
      }

      const selectionStr = selection as string

      // Handle quit
      if (selectionStr === '__quit__') {
        p.log.warn('Quitting review early...')
        break
      }

      // Handle skip
      if (selectionStr === '__skip__') {
        corrections.push({
          issueIndex: i,
          originalText: issue.originalText,
          correction: '',
          action: 'skip',
        })
        p.log.info(colors.dim('Skipped'))
        continue
      }

      // Handle custom input
      if (selectionStr === '__custom__') {
        const customInput = await p.text({
          message: 'Enter your correction:',
          placeholder: issue.suggestedFix || issue.originalText,
        })

        if (p.isCancel(customInput) || !customInput) {
          corrections.push({
            issueIndex: i,
            originalText: issue.originalText,
            correction: '',
            action: 'skip',
          })
          p.log.info(colors.dim('Skipped'))
        } else {
          corrections.push({
            issueIndex: i,
            originalText: issue.originalText,
            correction: customInput as string,
            action: 'custom',
          })
          p.log.success(`Custom: ${customInput}`)
        }
        continue
      }

      // Handle accepted option (suggestion or alternative)
      const correctionText = selectionStr.replace(/^__(accept|option)__:/, '')
      corrections.push({
        issueIndex: i,
        originalText: issue.originalText,
        correction: correctionText,
        action: 'accept',
      })
      p.log.success(`Accepted: ${correctionText}`)
    }

    // Summary
    const applied = corrections.filter((c) => c.action !== 'skip').length
    const skipped = corrections.filter((c) => c.action === 'skip').length
    p.outro(`Review complete: ${applied} applied, ${skipped} skipped`)

    return corrections
  }

  private getIssueTypeLabel(type: string): string {
    switch (type) {
      case 'unclear':
        return colors.bold(colors.yellow('❓ UNCLEAR WORD'))
      case 'technical':
        return colors.bold(colors.cyan('📚 TECHNICAL TERM'))
      case 'name':
        return colors.bold(colors.blue('👤 NAME SPELLING'))
      case 'inaudible':
        return colors.bold(colors.red('🔇 INAUDIBLE'))
      case 'crosstalk':
        return colors.bold(colors.magenta('🗣️  CROSSTALK'))
      case 'filler':
        return colors.bold(colors.gray('🗑️  FILLER'))
      case 'stutter':
        return colors.bold(colors.gray('🔁 STUTTER'))
      case 'false_start':
        return colors.bold(colors.gray('⏮️  FALSE START'))
      default:
        return colors.bold(type.toUpperCase())
    }
  }
}
