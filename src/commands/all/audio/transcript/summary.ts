import * as path from 'node:path'
import { generateText } from 'ai'
import { aiModel, aiModelByProfile, ROLES } from '#shared/ai/models.ts'
import { extractJson } from '#shared/ai/extractJson.ts'
import colors from 'picocolors'
import openEditor from 'open-editor'
import { type RenderInput, renderPromptFile } from '#shared/prompts/mod.ts'
import { readTextFile, writeTextFile } from '#shared/fs/mod.ts'
import { logger } from '#shared/log.ts'
import { env, isTerminal, readStdin, setRaw, writeStdout } from '#shared/sys/mod.ts'
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
  fromTranscript: Flag.string(
    'Run transcript pipeline: clean, then summarize. Optional path to transcript file, or omit to use the newest .vtt/.srt on the Desktop.',
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
}

type Params = InferParams<typeof params>

type Result = {
  outputPath: string | null
  title: string
  time: string | null // PlainDateTime format: YYYY-MM-DDTHH:MM
  durationMinutes: number | null
  medium: string | null // Call medium: Zoom, Phone, Google Meet, etc.
  who: string[] // Attendees - people in the meeting
  rel: string[] // Related - people mentioned but not attending
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
      'sky audio:transcript:summary --from-transcript # Clean + summarize newest .vtt/.srt on Desktop',
    ],
    params,
  }

  async run({ args, context, tasks }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    const {
      file,
      text,
      fromAudio,
      fromTranscript,
      title,
      output: outputArg,
      save: saveArg,
      template,
      summaryPrompt: summaryPromptPath,
      extractPrompt: extractPromptPath,
    } = args
    const builtin = PROMPT_FILES[template as keyof typeof PROMPT_FILES] ?? PROMPT_FILES.meeting
    const prompts = {
      summary: summaryPromptPath ?? builtin.summary,
      extract: extractPromptPath ?? builtin.extract,
    }

    // Handle pipeline: delegate to clean (audio transcribes first), then summarize
    const useAudioPipeline = fromAudio !== undefined
    const useCleanPipeline = useAudioPipeline || fromTranscript !== undefined

    let transcript: string
    let pipelineWho: string[] = []
    let pipelineRel: string[] = []
    let pipelineAudioFilePath: string | null = null
    let pipelineDuration: number | null = null
    let transcriptFilePath: string | null = null

    if (useCleanPipeline) {
      // --from-audio: transcribe → clean. --from-transcript: clean an existing transcript.
      const cleanResult = await tasks.run(
        'audio:transcript:clean',
        useAudioPipeline ? { fromAudio } : { fromTranscript },
      )
      if (!cleanResult.ok || !cleanResult.data) {
        return CommandResult.fail(`Transcript pipeline failed: ${cleanResult.message}`)
      }
      transcript = cleanResult.data.cleanedText
      pipelineWho = cleanResult.data.who
      pipelineRel = cleanResult.data.rel
      pipelineAudioFilePath = cleanResult.data.audioFilePath
      pipelineDuration = cleanResult.data.durationMinutes
      transcriptFilePath = cleanResult.data.transcriptFilePath
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
    } else {
      transcript = await this.readMultilineInput(output)
    }

    if (!transcript.trim()) {
      return CommandResult.fail('No transcript content provided')
    }

    log.debug('transcript received', { chars: transcript.length, lines: transcript.split('\n').length })
    output.log(colors.gray(`\nReceived ${transcript.split('\n').length} lines of transcript`))

    // 2. Load and render summary prompt
    const promptContent = await readTextFile(prompts.summary)

    const renderInput: RenderInput = {
      context: {
        notebookDate: context.notebookNow.date,
        systemDate: context.systemNow.date,
        notebookTimezone: context.notebookNow.timezone,
        systemTimezone: context.systemNow.timezone,
      },
      user: { input: transcript },
    }

    const { output: summaryPrompt } = renderPromptFile(promptContent, 'transcript-summary.prompt.md', renderInput)

    // 3. Generate summary with AI
    output.log(colors.cyan('\nGenerating summary...'))

    let summary: string
    try {
      const result = await generateText({
        ...aiModelByProfile(SUMMARY_MODEL),
        prompt: summaryPrompt,
        maxRetries: 0,
        timeout: 20 * 60 * 1000, // 20 min
      })
      summary = result.text
    } catch (err) {
      const error = err as Error
      output.error(`AI Error: ${error.message}`)
      return CommandResult.error(error, 'Failed to generate summary')
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
    }

    output.log(colors.cyan('Extracting metadata...'))

    const extractPromptContent = await readTextFile(prompts.extract)
    const { output: extractPrompt } = renderPromptFile(extractPromptContent, 'transcript-summary-extract.prompt.md', {
      ...renderInput,
      user: { input: summary },
    })

    let extractedTitle: string = 'Untitled'
    let extractedTime: string | null = null
    let extractedDuration: number | null = null
    let extractedMedium: string | null = null
    let extractedWho: string[] = []
    let extractedRel: string[] = []
    let extractedFrom: string | null = null
    let extractedTo: string | null = null
    const isMessageTemplate = template === 'audio-message'

    // Hoisted so the failure warn can carry the payload that failed to parse.
    let extractRaw = ''
    try {
      const result = await generateText({
        ...aiModel('balanced'),
        prompt: extractPrompt,
        maxRetries: 0,
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
      if (isMessageTemplate) {
        extractedFrom = extracted.from || null
        extractedTo = extracted.to || null
      } else {
        extractedWho = Array.isArray(extracted.who) ? extracted.who : []
      }
    } catch (err) {
      output.log(colors.yellow('Metadata extraction failed — continuing with defaults'))
      log.warn('metadata extraction failed', { error: err, raw: extractRaw })
    }

    // Duration computed from VTT cue timestamps is exact — prefer it over the
    // model's guess from the summary prose. User corrections below still override.
    if (pipelineDuration !== null) extractedDuration = pipelineDuration

    // Merge who/rel: prefer the analysis step's lists — it phonetically matched names
    // against known contacts (canonical full names), so it's the authoritative source.
    // Fall back to the summary-extracted lists on the paste/file path (no analysis step).
    // Shown in the confirmation box below; user corrections override them.
    let finalWho = pipelineWho.length > 0 ? pipelineWho : extractedWho
    let finalRel = pipelineRel.length > 0 ? pipelineRel : extractedRel

    const finalTitle = title !== 'Transcript Summary' ? title : extractedTitle

    // Extract summary section (different header per template)
    const summarySection = isMessageTemplate
      ? extractSection(summary, 'Summary') || ''
      : extractSection(summary, 'Meeting Summary') || ''

    // Dump summary to /tmp for debugging
    const tmpPath = `/tmp/transcript-summary-${slugify(finalTitle)}.md`
    await writeTextFile(tmpPath, summary)
    output.log(colors.gray(`\nDumped summary to: ${tmpPath}`))

    // Show extracted metadata for confirmation
    output.log(colors.cyan('\n─── Extracted Metadata ───'))
    output.log(colors.white(`  Title:    ${finalTitle}`))
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
    output.log(colors.cyan('──────────────────────────'))

    // Ask for corrections when running in a terminal
    if (isTerminal()) {
      const corrections = await this.askForCorrections(output)
      if (corrections) {
        output.log(colors.cyan('\nParsing corrections...'))

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
            prompt: `Parse these user corrections for metadata. Extract any fields the user is updating.

Current metadata:
- title: ${extractedTitle}
- time: ${extractedTime ?? 'null'}
- durationMinutes: ${extractedDuration ?? 'null'}
- medium: ${extractedMedium ?? 'null'}
${peopleFields}
- rel: ${JSON.stringify(finalRel)}

User corrections:
${corrections}

Return ONLY a JSON object with the fields that should be updated. Rules:
- time must be in format "YYYY-MM-DD HH:MM" (zero-padded)
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
          if (parsed.time) extractedTime = parsed.time
          if (parsed.durationMinutes !== undefined) extractedDuration = parsed.durationMinutes
          if (parsed.medium) extractedMedium = parsed.medium
          if (isMessageTemplate) {
            if (parsed.from) extractedFrom = parsed.from
            if (parsed.to) extractedTo = parsed.to
          } else {
            if (Array.isArray(parsed.who)) finalWho = parsed.who
          }
          if (Array.isArray(parsed.rel)) finalRel = parsed.rel

          output.log(colors.green('Applied corrections.'))
        } catch (err) {
          output.log(colors.yellow(`Failed to parse corrections: ${err}`))
          log.warn('correction parse failed', { error: err, raw: jsonText })
        }
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
      const home = env.get('HOME')
      if (!home) {
        return CommandResult.error(new Error('HOME not set'), 'Could not determine home directory')
      }
      outputPath = path.join(home, 'Desktop', filename)
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

    return CommandResult.success({
      outputPath,
      title: correctedTitle,
      time: extractedTime,
      durationMinutes: extractedDuration,
      medium: extractedMedium,
      who: finalWho,
      rel: finalRel,
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

  private async askForCorrections(output: OutputHandler): Promise<string | null> {
    output.log(colors.cyan('\nAny corrections? (Enter to accept, or type changes)'))
    output.log(colors.gray('  e.g., "time: 2026-01-20 14:30" or freeform feedback to improve the summary'))

    const isTTY = isTerminal()
    const decoder = new TextDecoder()
    const chunks: string[] = []

    // Write prompt without newline
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

        // Enter key (CR or LF)
        if (byte === 13 || byte === 10) {
          writeStdout('\n')
          break
        }

        // Ctrl+C
        if (byte === 3) {
          writeStdout('\n')
          return null
        }

        // Backspace
        if (byte === 127 || byte === 8) {
          if (chunks.length > 0) {
            chunks.pop()
            writeStdout('\b \b')
          }
          continue
        }

        const char = decoder.decode(buf.subarray(0, 1))
        chunks.push(char)
        writeStdout(buf) // Echo character without newline
      }
    } finally {
      if (isTTY) {
        setRaw(false)
      }
    }

    const input = chunks.join('').trim()
    return input || null
  }
}
