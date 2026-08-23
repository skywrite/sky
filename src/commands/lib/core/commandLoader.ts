import { getManifest, type CommandEntry } from '#commands/all/cli/_commandsManifest.ts'
import type { Command } from '#commands/mod.ts'

/**
 * Resolving a command name to its class.
 *
 * Names are colon-form (`prices:fetch:crypto`) and resolve through the
 * manifest, which covers core, local, and global command directories. Local
 * definitions win over global, and global over core, so a personal command can
 * shadow a shipped one.
 *
 * The cache is module-level and therefore shared by every CommandService
 * instance — those are created per call and would otherwise re-import a
 * command class on each composed run.
 */

const commandCache = new Map<string, typeof Command>()

/** Find a command in the manifest by name (local overrides core). */
async function findCommand(commandName: string): Promise<CommandEntry | null> {
  const manifest = await getManifest()
  for (const source of ['local', 'global', 'core'] as const) {
    const entry = manifest.commands[source].find((c) => c.name === commandName)
    if (entry) return entry
  }
  return null
}

/**
 * Load a command class by name, caching it for subsequent calls.
 *
 * Every failure mode names the command and what to do about it: these surface
 * to whoever typed the name, and "not found" is far more often a stale
 * manifest than a typo.
 *
 * @throws when the name is unknown, the module fails to import, or the module
 *   does not default-export a Command subclass.
 */
export async function loadCommand(commandName: string): Promise<typeof Command> {
  const cached = commandCache.get(commandName)
  if (cached) return cached

  const entry = await findCommand(commandName)
  if (!entry) {
    throw new Error(`Command '${commandName}' not found. Run 'sky cli:commands --rebuild' to update the manifest.`)
  }

  // deno-lint-ignore no-explicit-any
  let commandMod: any
  try {
    commandMod = await import(entry.file)
  } catch (e) {
    throw new Error(`Failed to load command '${commandName}' from ${entry.file}: ${(e as Error).message}`)
  }

  const TaskClass = commandMod.default
  if (!TaskClass || typeof TaskClass !== 'function' || !TaskClass.description) {
    throw new Error(`Command '${commandName}' does not export a Command class as default export`)
  }

  commandCache.set(commandName, TaskClass)
  return TaskClass
}
