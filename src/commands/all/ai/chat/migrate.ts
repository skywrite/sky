import * as path from 'node:path'
import colors from 'picocolors'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DIR_STATE_AI_CHATS } from '#shared/config.ts'
import { exists, readTextFile, walk, writeTextFile } from '#shared/fs/mod.ts'
import { migrateChatMarkdown } from '#shared/models/Chat/document/migrate.ts'
import ChatDocument, { userSpeakerLabel } from '#shared/models/Chat/document/mod.ts'
import { isAIChatPath } from '#shared/nbfs/mod.ts'

const params = {
  execute: Flag.bool('Rewrite the files (dry-run by default)', { default: false }),
}

type Params = InferParams<typeof params>
type Result = {
  scanned: number
  current: number
  migrated: number
  /** Files left untouched because the result would not read back as the same messages */
  refused: string[]
  unreadable: string[]
  dryRun: boolean
}

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'ai:chat:migrate': { params: Params; result: Result }
  }
}

/** Every saved chat under the time tree, branches and reply threads included, then the crash snapshots. */
async function chatFiles(timeDir: string): Promise<string[]> {
  const files: string[] = []
  if (await exists(timeDir)) {
    for await (const entry of walk(timeDir, { includeDirs: false, exts: ['.md'] })) {
      if (isAIChatPath(entry.path)) files.push(entry.path)
    }
  }
  if (await exists(DIR_STATE_AI_CHATS)) {
    for await (const entry of walk(DIR_STATE_AI_CHATS, { includeDirs: false, exts: ['.md'], maxDepth: 1 })) {
      files.push(entry.path)
    }
  }
  return files.sort()
}

export default class AiChatMigrateTask extends Command {
  static override description: CommandDescription = {
    name: 'ai:chat:migrate',
    description: 'Move saved chats into the Conversation section shape',
    descriptionLong: [
      'Saved chats keep their messages under a `## Conversation` section, one',
      '`### 2026-02-08 14:32 - **Name**` heading per message. Chats saved before',
      'that put each message at `##` under the title, and this version no longer',
      'reads them. This rewrites every saved chat and crash snapshot still in the',
      'earlier shape: only the speaker headings change and the section heading is',
      'added; frontmatter, message text and the context log keep every byte.',
      'A file whose result would not read back as the same messages is left',
      'untouched and listed. Dry-run by default — pass --execute to rewrite.',
    ],
    usage: [
      'sky ai:chat:migrate              # Dry-run: count what would change',
      'sky ai:chat:migrate --execute    # Rewrite the files',
    ],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output, config } = context
    const dryRun = !args.execute
    const userLabel = userSpeakerLabel()
    const base = path.dirname(config.DIR_TIME as string)
    const result: Result = { scanned: 0, current: 0, migrated: 0, refused: [], unreadable: [], dryRun }

    output.log(dryRun ? 'DRY RUN — no files will change. Pass --execute to rewrite.\n' : 'Rewriting saved chats.\n')

    for (const file of await chatFiles(config.DIR_TIME as string)) {
      result.scanned++
      const shown = file.startsWith(base) ? path.relative(base, file) : file
      let raw: string
      try {
        raw = await readTextFile(file)
      } catch {
        result.unreadable.push(shown)
        continue
      }
      const migration = migrateChatMarkdown(raw, userLabel)
      if (migration.outcome === 'current') {
        result.current++
        continue
      }
      // Every speaker heading the earlier shape had must come back as a message, and nothing else.
      const doc = ChatDocument.fromMarkdown(migration.markdown)
      if (doc.legacyShape || doc.turns.length !== migration.speakers) {
        result.refused.push(shown)
        continue
      }
      if (!dryRun) await writeTextFile(file, migration.markdown)
      result.migrated++
    }

    const verb = dryRun ? 'would move' : 'moved'
    output.log(
      `${result.scanned} saved chats and snapshots: ${result.migrated} ${verb}, ${result.current} already current.`,
    )
    for (const file of result.refused) {
      output.log(colors.yellow(`  Left as is: ${file} — the converted file would not read back as the same messages.`))
    }
    for (const file of result.unreadable) output.log(colors.yellow(`  Could not read: ${file}`))
    if (result.refused.length > 0) {
      output.log('A file left as is will not open as a chat until its speaker headings are fixed by hand.')
    }
    return CommandResult.success(result)
  }
}
