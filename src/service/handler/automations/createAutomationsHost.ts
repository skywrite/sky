import * as path from 'node:path'
import CommandContext from '#commands/lib/core/CommandContext.ts'
import CommandService from '#commands/lib/core/CommandService.ts'
import type * as ConfigModule from '#shared/config.ts'
import { exists, outputFile, readTextFile, rename } from '#shared/fs/mod.ts'
import { loadAutomationDir } from '#shared/models/Automation/loadAutomationDir.ts'
import Automation from '#shared/models/Automation/mod.ts'
import { setAutomationStatus } from '#shared/models/Automation/setStatus.ts'
import type {
  AutomationsReport,
  AutomationsRoutesOptions,
  CreateOutcome,
  DraftReport,
  RunNowReport,
  SaveOutcome,
} from './mod.ts'

/**
 * The automations page over the real notebook: reads are one in-process
 * automations:status run per request, so the page and the CLI can never
 * disagree; the two writes are as narrow as they sound — a textual status:
 * flip in the charter, and automations:run without a stamp.
 */

export function createAutomationsHost(
  config: typeof ConfigModule,
  env: Record<string, string>,
): AutomationsRoutesOptions {
  const service = () => new CommandService(CommandContext.server(config, env))

  return {
    status: async (): Promise<AutomationsReport> => {
      const result = await service().run('automations:status', { verbose: false })
      if (result.status !== 'success' || !result.data) {
        throw new Error(result.message ?? 'automations:status failed')
      }
      return { ...result.data, dir: config.DIR_AUTOMATIONS }
    },

    setStatus: async (name, status): Promise<boolean> => {
      const { byName } = await loadAutomationDir(config.DIR_AUTOMATIONS)
      const entry = byName.get(name)
      if (!entry) return false

      const updated = setAutomationStatus(await readTextFile(entry.path), status)
      // Through a temporary file, as the state store writes: the charter is
      // the person's file, and a torn write would lose their words.
      const temp = `${entry.path}.tmp`
      await outputFile(temp, updated)
      await rename(temp, entry.path)
      return true
    },

    runNow: async (name): Promise<RunNowReport | null> => {
      const result = await service().run('automations:run', { name, stamp: false })
      // A run that failed still reports — fail-with-data is the command saying
      // "I ran it and it broke", while fail-without-data means no such charter.
      if (!result.data) return null
      const { outcome, message } = result.data
      return message === undefined ? { outcome } : { outcome, message }
    },

    draft: async (request, revise): Promise<DraftReport> => {
      const result = await service().run('automations:draft', { request, revise, json: false })
      if (result.status !== 'success' || !result.data) {
        throw new Error(result.message ?? 'automations:draft failed')
      }
      return result.data
    },

    create: async (name, contents): Promise<CreateOutcome> => {
      try {
        Automation.fromMarkdown(contents, name)
      } catch (err) {
        return { kind: 'invalid', message: err instanceof Error ? err.message : String(err) }
      }
      if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
        return { kind: 'invalid', message: `name "${name}" is not kebab-case` }
      }
      const file = path.join(config.DIR_AUTOMATIONS, `${name}.md`)
      const { byName } = await loadAutomationDir(config.DIR_AUTOMATIONS)
      if (byName.has(name) || (await exists(file))) return { kind: 'exists' }

      const temp = `${file}.tmp`
      await outputFile(temp, contents)
      await rename(temp, file)
      return { kind: 'created' }
    },

    save: async (name, contents): Promise<SaveOutcome> => {
      const { byName } = await loadAutomationDir(config.DIR_AUTOMATIONS)
      const entry = byName.get(name)
      if (!entry) return { kind: 'missing' }
      try {
        Automation.fromMarkdown(contents, name)
      } catch (err) {
        return { kind: 'invalid', message: err instanceof Error ? err.message : String(err) }
      }

      const temp = `${entry.path}.tmp`
      await outputFile(temp, contents)
      await rename(temp, entry.path)
      return { kind: 'saved' }
    },
  }
}
