import { existsSync } from 'node:fs'
import { utimes } from 'node:fs/promises'
import * as path from 'node:path'
import { buildManifest } from '#commands/all/cli/_commandsManifest.ts'
import CommandContext from '#commands/lib/core/CommandContext.ts'
import CommandService from '#commands/lib/core/CommandService.ts'
import { BufferedOutput } from '#commands/lib/output/BufferedOutput.ts'
import type { OutputHandler } from '#commands/lib/output/OutputHandler.ts'
import { setExtensionEnabled } from '#lib/extensions/install.ts'
import { EXTENSIONS_DIR, listInstalled } from '#lib/extensions/installed.ts'
import type * as Config from '#shared/config.ts'
import type { ExtensionRoutesOptions, ExtensionRow, ExtensionRunAnswer } from './routes.ts'

/** How long a screen's command may run before the page is told it did not finish. */
export const RUN_TIMEOUT_MS = 2 * 60 * 1000

/** A buffer whose child runs write into it, so the lines a command prints come back with its result. */
class CapturedOutput extends BufferedOutput {
  override child(): OutputHandler {
    return this
  }
}

/** The real machine: the installed extensions on disk, their commands through the command service. */
export function createExtensionsHost(config: typeof Config, env: Record<string, string>): ExtensionRoutesOptions {
  return {
    async list(): Promise<ExtensionRow[]> {
      return (await listInstalled()).map((e) => ({
        id: e.id,
        author: e.author,
        slug: e.slug,
        name: e.manifest.sky.name,
        version: e.manifest.version,
        description: e.manifest.description,
        categories: [...e.manifest.sky.categories],
        authorName: e.manifest.author.name,
        from: e.linkedFrom ?? e.dir,
        enabled: e.enabled,
        ...(e.problem ? { problem: e.problem } : {}),
        ui: existsSync(path.join(e.dir, 'ui', 'index.tsx')),
      }))
    },

    async run(command, args) {
      const prefix = command.split(':')[0]
      const owner = (await listInstalled()).find((e) => e.slug === prefix && !e.problem && e.enabled)
      if (!owner) return null
      const output = new CapturedOutput()
      const signal = AbortSignal.timeout(RUN_TIMEOUT_MS)
      const context = CommandContext.server(config, env).fork({ output, signal })
      // The command gets the signal; a command that ignores it still answers
      // the page on time, and keeps running to its own end.
      const tooLong = new Promise<ExtensionRunAnswer>((resolve) =>
        signal.addEventListener('abort', () =>
          resolve({ status: 'error', message: `${command} did not finish within two minutes.`, log: output.getLogs() }),
        ),
      )
      const run = (async (): Promise<ExtensionRunAnswer> => {
        try {
          const result = await new CommandService(context).run(command, args)
          return {
            status: result.status,
            ...(result.data !== undefined ? { data: result.data } : {}),
            ...(result.message ? { message: result.message } : {}),
            log: output.getLogs(),
          }
        } catch (error) {
          return { status: 'error', message: (error as Error).message, log: output.getLogs() }
        }
      })()
      return Promise.race([run, tooLong])
    },

    async enable(id, enabled) {
      const outcome = await setExtensionEnabled(id, enabled)
      if (!outcome.changed) return { ok: false, reason: outcome.reason }
      await touchExtensions()
      return { ok: true }
    },

    async reload() {
      await buildManifest()
      await touchExtensions()
    },
  }
}

/** A newer mtime on the extensions folder makes the web bundle build again on its next request. */
async function touchExtensions(): Promise<void> {
  if (!existsSync(EXTENSIONS_DIR)) return
  const now = new Date()
  await utimes(EXTENSIONS_DIR, now, now)
}
