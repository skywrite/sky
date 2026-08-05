import { unlink } from 'node:fs/promises'
import * as p from '@clack/prompts'
import { createImapClient, removeLabel } from '#commands/all/email/lib/imap-client.ts'
import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import EmailFollowRegistry from '#shared/models/Follow/EmailFollowRegistry.ts'

const params = {
  file: Arg.string('Follow file name (without .yaml extension)', { optional: true }),
  dryRun: Flag.boolean('Show what would be closed without deleting', { default: false }),
}

type Params = InferParams<typeof params>
type Result = { closed: string[] }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'follow:email:close': { params: Params; result: Result }
  }
}

export default class FollowEmailCloseTask extends Command {
  static override description: CommandDescription = {
    name: 'follow:email:close',
    description: 'Close an email follow and remove the Gmail label.',
    descriptionLong: [
      'Removes the Gmail label from the thread via IMAP so future syncs skip it,',
      'then deletes the Follow YAML. Recorded messages in day entries are preserved.',
    ],
    usage: [
      'sky follow:email:close                         # Pick from list',
      'sky follow:email:close email_JP-Acme-Aptos   # By name',
      'sky follow:email:close --dry-run                # Preview without deleting',
    ],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output, secrets } = context
    const { file, dryRun } = args

    const registry = await EmailFollowRegistry.build()
    const emailFollows = registry.getAll()

    if (emailFollows.length === 0) {
      output.log('No email follows found.')
      return CommandResult.fail('No email follows to close')
    }

    // Select follow
    let selectedFile = file
    if (!selectedFile) {
      emailFollows.sort((a, b) => {
        const aLast = a.follow.messages.at(-1)?.date ?? ''
        const bLast = b.follow.messages.at(-1)?.date ?? ''
        return bLast.localeCompare(aLast)
      })

      const selected = await p.select({
        message: 'Which email follow do you want to close?',
        options: emailFollows.map((e) => ({
          value: e.fileName,
          label: e.follow.summary,
          hint: `${e.follow.ref.account} · ${e.follow.messages.length} msgs`,
        })),
      })

      if (p.isCancel(selected)) {
        p.cancel('Cancelled')
        return CommandResult.fail('User cancelled')
      }

      selectedFile = selected as string
    }

    const entry = registry.findByFileName(selectedFile)
    if (!entry) {
      return CommandResult.fail(`Follow not found: ${selectedFile}`)
    }

    if (dryRun) {
      output.log(`[dry-run] Would close: ${selectedFile}`)
      output.log(`[dry-run] Would remove label "${entry.follow.ref.label}" from thread ${entry.follow.ref.threadId}`)
      return CommandResult.success({ closed: [selectedFile] })
    }

    // Remove Gmail label via IMAP
    const { account, label } = entry.follow.ref
    if (account && label) {
      const creds = await secrets.get('email', account)
      if (creds && creds.type === 'login') {
        output.log(`  Removing label "${label}" from thread via IMAP...`)
        const client = createImapClient({ user: creds.user, pass: creds.pass })
        client.on('error', () => {}) // prevent uncaught socket errors in Deno
        try {
          await client.connect()
          const threadId = entry.follow.ref.threadId

          // Find messages in this label belonging to the thread
          const lock = await client.getMailboxLock(label)
          const threadUids: number[] = []
          try {
            const uids = await client.search({ all: true }, { uid: true })
            if (uids) {
              for (const uid of uids) {
                const msg = await client.fetchOne(String(uid), { envelope: true, threadId: true }, { uid: true })
                if (msg && msg.threadId === threadId) {
                  threadUids.push(uid)
                }
              }
            }
          } finally {
            lock.release()
          }

          if (threadUids.length > 0) {
            await removeLabel(client, label, threadUids)
            output.log(`  Removed label from ${threadUids.length} message(s).`)
          } else {
            output.log(`  No messages found for thread ${threadId} in "${label}".`)
          }
        } catch (err) {
          output.log(`  Warning: could not remove label via IMAP: ${(err as Error).message}`)
        } finally {
          await client.logout().catch(() => {})
        }
      } else {
        output.log(`  Warning: no credentials for ${account}, skipping label removal.`)
      }
    }

    // Delete the follow YAML
    await unlink(entry.path)
    output.log(`  Closed follow: ${selectedFile}\n`)

    return CommandResult.success({ closed: [selectedFile] })
  }
}
