import { mkdir, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DIR_ATTACHMENTS, DIR_STATE } from '#config'
import slugify from '#lib/string/slugify.ts'
import { exists, readTextFile, writeTextFile } from '#shared/fs/mod.ts'
import dayAttachmentsDir from '#shared/nbfs/dayAttachmentsDir.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

const params = {
  dryRun: Flag.boolean('Show messages without updating offset', { short: 'n' }),
}

type Params = InferParams<typeof params>

type Result = { photos: number; texts: number }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'telegram:inbox:fetch': { params: Params; result: Result }
  }
}

interface TelegramState {
  offset?: number
  chatId?: number
}

const STATE_DIR = path.join(DIR_STATE, 'telegram')
const STATE_FILE = path.join(STATE_DIR, 'state.json')

async function loadState(): Promise<TelegramState> {
  if (await exists(STATE_FILE)) {
    return JSON.parse(await readTextFile(STATE_FILE))
  }
  return {}
}

async function saveState(state: TelegramState): Promise<void> {
  await mkdir(STATE_DIR, { recursive: true })
  await writeTextFile(STATE_FILE, JSON.stringify(state, null, 2) + '\n')
}

export default class TelegramInboxFetchTask extends Command {
  static override description: CommandDescription = {
    name: 'telegram:inbox:fetch',
    description: 'Poll Telegram bot for new messages and download photos.',
    descriptionLong: [
      'Polls the Telegram Bot API for unprocessed messages.',
      'Saves photos to attachments folder and runs message:new for each.',
      'Prints text messages to console.',
    ],
    usage: ['sky telegram:inbox:fetch', 'sky telegram:inbox:fetch --dry-run'],
    params,
  }

  async run({ args, context, tasks }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output, env } = context
    const dryRun = args.dryRun ?? false

    const token = env.TELEGRAM_BOT_TOKEN
    if (!token) {
      return CommandResult.fail('No bot token. Set TELEGRAM_BOT_TOKEN in .env')
    }

    const api = `https://api.telegram.org/bot${token}`

    // Validate token by calling getMe
    const meRes = await fetch(`${api}/getMe`)
    const meBody = await meRes.json()
    if (!meRes.ok || !meBody.ok) {
      return CommandResult.fail(
        `Invalid bot token — check TELEGRAM_BOT_TOKEN in .env (${meRes.status}: ${
          meBody.description || 'unknown error'
        })`,
      )
    }
    output.log(`Bot: @${meBody.result.username}`)

    const state = await loadState()

    // Fetch updates
    const url = state.offset != null ? `${api}/getUpdates?offset=${state.offset}` : `${api}/getUpdates`
    const res = await fetch(url)
    const body = await res.json()
    if (!res.ok || !body.ok) {
      return CommandResult.fail(`Telegram API error: ${res.status} — ${body.description || res.statusText}`)
    }

    const updates: any[] = body.result
    if (updates.length === 0) {
      output.log('No new messages.')
      return CommandResult.success({ photos: 0, texts: 0 })
    }

    // First-run: capture chat ID from first message
    if (state.chatId == null) {
      const firstMsg = updates[0].message
      if (firstMsg) {
        state.chatId = firstMsg.chat.id
        output.log(`Captured chat ID: ${state.chatId}`)
      }
    }

    // Filter to our chat
    const messages = updates.filter((u: any) => u.message && u.message.chat.id === state.chatId)

    let photos = 0
    let texts = 0

    for (const update of messages) {
      const msg = update.message
      const date = new Date(msg.date * 1000)
      const ts = formatTimestamp(date)
      const caption = msg.caption || ''

      if (msg.photo && msg.photo.length > 0) {
        // Download highest-resolution photo
        const best = msg.photo[msg.photo.length - 1]
        const msgDate = PlainDate.from(`${ts.slice(0, 10)}`)
        const ext = '.jpg'
        const fileName = caption
          ? `${msgDate}_${slugify(caption, { preserveCase: true, suggestedLength: 60 })}${ext}`
          : `${ts}${ext}`

        const attachDir = path.join(DIR_ATTACHMENTS, dayAttachmentsDir(msgDate))
        const destPath = path.join(attachDir, fileName)

        if (!dryRun) {
          const fileRes = await fetch(`${api}/getFile?file_id=${best.file_id}`)
          const fileBody = await fileRes.json()
          if (!fileBody.ok) {
            output.log(`  Failed to get file info for ${best.file_id}`)
            continue
          }
          const filePath = fileBody.result.file_path
          const downloadRes = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`)
          const bytes = new Uint8Array(await downloadRes.arrayBuffer())
          await mkdir(attachDir, { recursive: true })
          await writeFile(destPath, bytes)
          output.log(`  Saved: ${destPath}`)

          // Run message:new for AI extraction
          const msgArgs: Record<string, string> = { fromImage: destPath }
          if (caption) msgArgs.aiContext = caption
          const result = await tasks.run('message:new', msgArgs)
          if (!result.ok) {
            output.log(`  message:new failed: ${result.message}`)
          }
        } else {
          output.log(`  [dry-run] Photo → ${destPath}`)
        }
        output.log('')
        photos++
      } else if (msg.text) {
        output.log(`  Text [${ts}]: ${msg.text}`)
        texts++
      }
    }

    // Update offset
    const maxUpdateId = Math.max(...updates.map((u: any) => u.update_id))
    if (!dryRun) {
      state.offset = maxUpdateId + 1
      await saveState(state)
    }

    output.log(`Summary: ${photos} photo(s) downloaded, ${texts} text message(s).`)
    return CommandResult.success({ photos, texts })
  }
}

function formatTimestamp(date: Date): string {
  const y = date.getFullYear()
  const mo = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const h = String(date.getHours()).padStart(2, '0')
  const mi = String(date.getMinutes()).padStart(2, '0')
  const s = String(date.getSeconds()).padStart(2, '0')
  return `${y}-${mo}-${d}_${h}-${mi}-${s}`
}
