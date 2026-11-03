import type { CommandEntry, CommandsManifest } from '#commands/all/cli/_commandsManifest.ts'
import type { ReviewJob } from './types.ts'

/** The recaps a review can offer: every installed `recap:<app>` command that takes a day, by title. */
export function installedRecaps(manifest: CommandsManifest): Pick<ReviewJob, 'id' | 'title'>[] {
  // Later sources win, as when a command runs: local, then global, then core.
  const commands = new Map<string, CommandEntry>()
  for (const command of [...manifest.commands.core, ...manifest.commands.global, ...manifest.commands.local])
    commands.set(command.name, command)
  return [...commands.values()]
    .filter(
      (command) =>
        /^recap:[^:]+$/.test(command.name) &&
        command.flags.some((flag) => flag.name === 'day' && flag.type === 'plainDate'),
    )
    .map((command) => {
      const id = command.name.slice('recap:'.length)
      return { id, title: `${appName(id, command.description)} recap` }
    })
    .sort((a, b) => a.title.localeCompare(b.title))
}

/** The app as its description writes it: claude-code in "Recap the day's Claude Code sessions" is Claude Code. */
function appName(id: string, description: string): string {
  const words = id.replaceAll('-', ' ')
  const at = description.toLowerCase().indexOf(words)
  const name = at < 0 ? words : description.slice(at, at + words.length)
  return name.charAt(0).toUpperCase() + name.slice(1)
}
