import { Command, CommandResult } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription } from '#commands/mod.ts'
import { FILE_ABOUT_ME } from '#shared/config.ts'
import { exists, readTextFile } from '#shared/fs/mod.ts'
import { AboutMeDocument } from '#shared/models/AboutMe/mod.ts'

export default class JournalMeBioTask extends Command {
  static override description: CommandDescription = {
    name: 'journal:me:bio',
    description: 'Output bio from About Me profile (for prompt injection)',
    descriptionLong: [
      'Reads the bio section from me/about.md',
      'and outputs it. Useful for piping into prompts or other commands.',
    ],
    usage: [
      'sky journal:me:bio              # Output bio to stdout',
      'sky journal:me:bio | pbcopy     # Copy bio to clipboard',
    ],
  }

  async run({ context }: CommandArgs): Promise<CommandResult<{ bio: string }>> {
    const { output } = context

    if (!(await exists(FILE_ABOUT_ME))) {
      return CommandResult.fail('No profile found. Run `sky journal:me:update` first.')
    }

    const content = await readTextFile(FILE_ABOUT_ME)
    const doc = AboutMeDocument.fromMarkdown(content)
    const bio = doc.bio

    if (!bio) {
      return CommandResult.fail('No bio found in profile. Run `sky journal:me:update` to generate one.')
    }

    output.log(bio)
    return CommandResult.success({ bio })
  }
}
