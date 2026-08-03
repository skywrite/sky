import * as path from 'node:path'
import { copyFile, mkdir, rename, stat } from 'node:fs/promises'
import * as p from '@clack/prompts'
import colors from 'picocolors'
import openEditor from '#lib/shell/openEditor.ts'
import { DayDirFileWriter, messageFileName, writeDayItems } from '#lib/nbfs/mod.ts'
import { ArgOrFlag, categoryComplete, Command, CommandResult, Flag, whenNBTime } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { validateAnyArgFlagExists } from '#commands/cli/mod.ts'
import slugify from '#lib/string/slugify.ts'
import MessageDocument from '#shared/models/Message/mod.ts'
import dayAttachmentsDir from '#shared/nbfs/dayAttachmentsDir.ts'
import { exists } from '#shared/fs/mod.ts'
import { MCPTool } from '#mcp/decorators.ts'
import { extractMessageFromImage, renameSenders, renderDialogue, senderSummary } from './_lib/extractFromImage.ts'
import { findScreenshotsOnDesktop } from './_lib/findScreenshotOnDesktop.ts'
import { parseCorrections } from './_lib/parseCorrections.ts'

function relativeAge(nowMs: number, filePath: string): string {
  // Parse macOS screenshot timestamp from filename (e.g. "Screenshot 2026-02-24 at 3.45.12 PM")
  const match = path.basename(filePath).match(/(\d{4}-\d{2}-\d{2}) at (\d{1,2})\.(\d{2})\.(\d{2})\s*(AM|PM)?/i)
  if (match) {
    let hours = parseInt(match[2])
    const minutes = parseInt(match[3])
    const ampm = match[5]
    if (ampm) {
      if (ampm.toUpperCase() === 'PM' && hours !== 12) hours += 12
      if (ampm.toUpperCase() === 'AM' && hours === 12) hours = 0
    }
    const d = new Date(`${match[1]}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${match[4]}`)
    const diffMs = nowMs - d.getTime()
    return formatDuration(diffMs)
  }
  return ''
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

const params = {
  to: ArgOrFlag.string('Channel or person', { short: 't' }),
  from: Flag.string('Who the communication was from', { short: 'f' }),
  summary: Flag.string('Summary of message', { short: 's' }),
  medium: Flag.string('Communication medium e.g. WhatsApp, iMessage, etc', { short: 'm' }),
  fromImage: Flag.string('Path(s) to screenshot(s), comma-separated, or omit path to search Desktop', {
    short: 'i',
    optional: true,
  }),
  fromAudio: Flag.string('Path to audio file, or omit path to search Desktop', { optional: true }),
  aiContext: Flag.string('Additional context for AI image extraction', { optional: true }),
  when: whenNBTime(),
  category: categoryComplete(),
}

type Params = InferParams<typeof params>
type Result = { filePath: string }

@MCPTool()
export default class MessageNewTask extends Command {
  static override description: CommandDescription = {
    name: 'message:new',
    description: 'Create new communication.',
    params,
    postProcess: [validateAnyArgFlagExists('to', 'from', 'fromImage', 'fromAudio')],
  }

  async run({ args, context, tasks, rawArgs }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output, config } = context
    let { when, to, from, medium, summary, category, fromImage, fromAudio, aiContext } = args
    let body: string | undefined
    let attachmentFiles: string[] = []
    let audioRel: string[] | undefined

    // --from-audio pipeline: transcribe → clean → summarize (via audio:transcript:summary)
    const useAudioPipeline = fromAudio !== undefined

    if (useAudioPipeline) {
      const summaryResult = await tasks.run('audio:transcript:summary', { fromAudio, template: 'audio-message' })
      if (!summaryResult.ok || !summaryResult.data) {
        return CommandResult.fail(`Audio pipeline failed: ${summaryResult.message}`)
      }

      const data = summaryResult.data

      // Apply extracted metadata (summary already prompted for corrections)
      if (!from) from = data.from || (data.who.length > 0 ? data.who[0] : undefined)
      if (!to) to = data.to || (data.who.length > 1 ? data.who[1] : undefined)
      if (!summary) summary = data.title
      if (data.rel.length > 0) audioRel = data.rel
      if (data.medium && !medium) medium = data.medium
      if (data.time) {
        const { PlainDateTime } = await import('#universal/dates/nbdt/mod.ts')
        when = new PlainDateTime(data.time)
      }

      // Format body with summary and transcript
      body = `${data.body}\n\n## Transcript\n\n${data.cleanedText}`

      // Prompt for medium if still not set
      if (!medium) {
        const selected = await p.select({
          message: 'Which messaging medium?',
          options: [
            { value: 'In Person', label: 'In Person' },
            { value: 'Phone', label: 'Phone' },
            { value: 'WhatsApp', label: 'WhatsApp' },
            { value: 'iMessage Audio', label: 'iMessage Audio' },
            { value: 'Voice Memo', label: 'Voice Memo' },
          ],
        })

        if (p.isCancel(selected)) {
          p.cancel('Cancelled.')
          return CommandResult.fail('Cancelled')
        }

        medium = selected
      }

      // Prompt to move audio file to attachments
      if (data.audioFilePath) {
        const audioPath = data.audioFilePath
        const moveConfirm = await p.confirm({ message: 'Move audio file to attachments?' })

        if (p.isCancel(moveConfirm)) {
          p.cancel('Cancelled.')
          return CommandResult.fail('Cancelled')
        }

        if (moveConfirm) {
          const messageDate = when.plainDate
          const whoStr = from && to ? `${from}-to-${to}` : from || to || ''
          const whoSlugPart = whoStr ? `_${slugify(whoStr, { preserveCase: true })}` : ''
          const summarySlugPart = summary
            ? `_${slugify(summary as string, { preserveCase: true, suggestedLength: 40 })}`
            : ''
          const attachDir = path.join(config.DIR_ATTACHMENTS as string, dayAttachmentsDir(messageDate))
          await mkdir(attachDir, { recursive: true })

          const ext = path.extname(audioPath)
          const newFileName = `${messageDate}_${slugify(medium as string, {
            preserveCase: true,
          })}${whoSlugPart}${summarySlugPart}${ext}`

          const destPath = path.join(attachDir, newFileName)
          await rename(audioPath, destPath).catch(async () => {
            await copyFile(audioPath, destPath)
          })
          attachmentFiles.push(newFileName)
          output.log(colors.gray(`Moved audio file to ${attachDir}\n`))
        }
      }
    }

    // --from-image pipeline
    const useImagePipeline = fromImage !== undefined

    if (useImagePipeline) {
      // 1. Resolve image path(s) (valueless --from-image gives boolean true at runtime)
      const hasExplicitPath = typeof fromImage === 'string' && fromImage !== 'true'
      let imagePaths: string[]
      if (hasExplicitPath) {
        imagePaths = fromImage
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => path.resolve(s))
        if (imagePaths.length === 0) {
          return CommandResult.fail('No image path given: --from-image /path/a.png,/path/b.png')
        }
      } else {
        output.log(colors.gray('No image path specified, searching Desktop...'))
        const found = await findScreenshotsOnDesktop()
        if (found.length === 0) {
          return CommandResult.fail('No screenshot found on Desktop. Specify a path: --from-image /path/to/image.png')
        }

        if (found.length === 1) {
          imagePaths = found
          output.log(colors.cyan(`Found: ${path.basename(found[0])}`))
        } else {
          const now = Date.now()
          const selected = await p.multiselect({
            message: 'Select screenshots to include (space to toggle, enter to confirm)',
            options: found.map((fp) => ({
              value: fp,
              label: path.basename(fp),
              hint: relativeAge(now, fp),
            })),
            required: true,
          })

          if (p.isCancel(selected)) {
            p.cancel('Cancelled.')
            return CommandResult.fail('Cancelled')
          }

          imagePaths = selected
        }
      }

      for (const ip of imagePaths) {
        if (!(await exists(ip))) {
          return CommandResult.fail(`File not found: ${ip}`)
        }
      }

      // Send screenshots in capture order — multiselect returns toggle order
      if (imagePaths.length > 1) {
        const withMtime = await Promise.all(
          imagePaths.map(async (ip) => ({ ip, mtime: (await stat(ip)).mtimeMs ?? 0 })),
        )
        withMtime.sort((a, b) => a.mtime - b.mtime)
        imagePaths = withMtime.map((x) => x.ip)
      }

      // 2. Extract conversation from image(s)
      const label = imagePaths.length === 1 ? 'screenshot' : `${imagePaths.length} screenshots`
      output.log(colors.gray(`Extracting conversation from ${label}...`))
      const participants = [from, to].filter(Boolean)
      const hints = [
        participants.length > 0
          ? `Known participant name(s): ${participants.join(', ')}. Use these exact names for the matching senders.`
          : '',
        aiContext ?? '',
      ].filter(Boolean)
      const extraction = await extractMessageFromImage(imagePaths, {
        aiContext: hints.length > 0 ? hints.join(' ') : undefined,
        referenceDate: `${when.plainDate}`,
      })

      // 3. Apply extracted values (CLI flags override AI)
      from = from || extraction.from || undefined
      to = to || extraction.to || undefined
      summary = summary || extraction.summary
      let messages = extraction.messages

      // A visible timestamp beats the clock: `when` defaults to now, which is when
      // the screenshot got filed, not when the conversation happened. rawArgs is
      // the parse before defaults are applied, so a `when` key there means the user
      // typed --when and meant it — that always wins over what the model read.
      if (extraction.when && rawArgs.when === undefined) {
        const { PlainDateTime } = await import('#universal/dates/nbdt/mod.ts')
        when = new PlainDateTime(extraction.when)
      }

      // 4. Resolve medium: CLI flag > AI detection > user prompt
      if (!medium && extraction.platform) {
        medium = extraction.platform
      }

      if (!medium) {
        const selected = await p.select({
          message: 'Which messaging platform?',
          options: [
            { value: 'WhatsApp', label: 'WhatsApp' },
            { value: 'Signal', label: 'Signal' },
            { value: 'iMessage', label: 'iMessage' },
            { value: 'Telegram', label: 'Telegram' },
            { value: 'Slack', label: 'Slack' },
          ],
        })

        if (p.isCancel(selected)) {
          p.cancel('Cancelled.')
          return CommandResult.fail('Cancelled')
        }

        medium = selected
      }

      // 5. Show extracted metadata and allow corrections
      output.log(colors.cyan('\n─── Extracted ───'))
      output.log(colors.white(`  From:     ${from ?? '(none)'}`))
      output.log(colors.white(`  To:       ${to ?? '(none)'}`))
      if (messages.length > 0) {
        output.log(colors.white(`  Senders:  ${senderSummary(messages)}`))
      }
      output.log(colors.white(`  Medium:   ${medium}`))
      output.log(colors.white(`  Summary:  ${summary ?? '(none)'}`))
      output.log(colors.white(`  When:     ${when}`))
      output.log(colors.white(`  Images:   ${imagePaths.length}`))
      if (extraction.continuityNotes) {
        output.log(colors.yellow(`  Notes:    ${extraction.continuityNotes}`))
      }
      output.log(colors.cyan('─────────────────'))

      const corrections = await p.text({
        message: 'Any corrections? (Enter to accept)',
        placeholder: 'e.g. medium: Signal, from: Alice, Me is Alice, when: 14:30',
      })

      if (p.isCancel(corrections)) {
        p.cancel('Cancelled.')
        return CommandResult.fail('Cancelled')
      }

      if (corrections) {
        output.log(colors.gray('Parsing corrections...'))
        const c = await parseCorrections({
          from,
          to,
          medium,
          summary,
          when: when.time,
          senders: [...new Set(messages.map((m) => m.sender))],
          corrections,
        })

        if (c.from !== undefined) from = c.from ?? undefined
        if (c.to !== undefined) to = c.to ?? undefined
        if (c.medium) medium = c.medium
        if (c.summary) summary = c.summary
        if (c.when) {
          const { PlainDateTime } = await import('#universal/dates/nbdt/mod.ts')
          // AI may return "HH:MM" or "YYYY-MM-DD HH:MM"
          const hasDate = c.when.includes('-')
          const dateTimeStr = hasDate ? c.when : `${when.plainDate} ${c.when}`
          when = new PlainDateTime(dateTimeStr)
        }
        if (c.senderRenames && c.senderRenames.length > 0) {
          messages = renameSenders(messages, c.senderRenames)
          // Keep metadata in sync when a renamed sender is also the from/to value
          // (explicit from:/to: corrections were applied above and win over this)
          for (const r of c.senderRenames) {
            if (from === r.from) from = r.to
            if (to === r.from) to = r.to
          }
        }

        output.log(colors.green('Applied corrections.'))
      }

      body = renderDialogue(messages)

      // 6. Prompt to move screenshots to attachments
      const moveLabel = imagePaths.length === 1 ? 'Move screenshot to attachments?' : 'Move screenshots to attachments?'
      const moveConfirm = await p.confirm({ message: moveLabel })

      if (p.isCancel(moveConfirm)) {
        p.cancel('Cancelled.')
        return CommandResult.fail('Cancelled')
      }

      if (moveConfirm) {
        const messageDate = when.plainDate
        const whoStr = from && to ? `${from}-to-${to}` : from || to || ''
        const whoSlugPart = whoStr ? `_${slugify(whoStr, { preserveCase: true })}` : ''
        const summarySlugPart = summary
          ? `_${slugify(summary as string, { preserveCase: true, suggestedLength: 40 })}`
          : ''
        const attachDir = path.join(config.DIR_ATTACHMENTS as string, dayAttachmentsDir(messageDate))
        await mkdir(attachDir, { recursive: true })

        for (let i = 0; i < imagePaths.length; i++) {
          const ip = imagePaths[i]
          const ext = path.extname(ip)
          const indexSuffix = imagePaths.length > 1 ? `_${i + 1}` : ''
          const newFileName = `${messageDate}_${slugify(medium as string, {
            preserveCase: true,
          })}${whoSlugPart}${summarySlugPart}${indexSuffix}${ext}`

          const destPath = path.join(attachDir, newFileName)
          await rename(ip, destPath).catch(async () => {
            await copyFile(ip, destPath)
          })
          attachmentFiles.push(newFileName)
        }
        output.log(colors.gray(`Moved ${attachmentFiles.length} screenshot(s) to ${attachDir}\n`))
      }
    }

    // Validate medium is set
    if (!medium) {
      return CommandResult.fail('Missing required flag: --medium (-m)')
    }

    const date = when.plainDate

    let who = to || from || ''
    if (to && from) {
      who = `${from} to ${to}`
    }

    const whoSlug = who ? `${slugify(who, { preserveCase: true })}` : ''
    const mediumSlug = slugify(<string>medium, { preserveCase: true })

    const summarySlug = slugify(<string>summary, { preserveCase: true, suggestedLength: 40 })
    const partialSlug = summarySlug ? `${whoSlug}_${summarySlug}` : whoSlug
    const fileName = messageFileName(when, mediumSlug, partialSlug)

    const ddfw = new DayDirFileWriter(date)
    const entryWhen = when.time

    const attachments = attachmentFiles.length > 0 ? attachmentFiles.map((f) => ({ file: f })) : undefined
    const message = new MessageDocument({
      from,
      to,
      when,
      medium,
      summary,
      attachments,
      ...(audioRel ? { rel: audioRel } : {}),
    })
    let data = message.toMarkdown()
    if (body) {
      data += '\n' + body
    }

    const filePath = await ddfw.write(fileName, data.trimStart())

    const commEntry = `${who} ${medium}`.trim() // we trim in case there's no 'who'

    const dayItem = `${entryWhen} > ${commEntry} -> [${summary || ''}](${filePath})`
    await writeDayItems(date, category, dayItem)

    await openEditor([{ file: path.join(ddfw.fullDir, filePath), line: data.split('\n').length }])

    output.log(`\n  Successfully created ${filePath}.\n`)

    return CommandResult.success()
  }
}
