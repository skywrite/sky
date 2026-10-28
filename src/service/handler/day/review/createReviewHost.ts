import * as path from 'node:path'
import { findRecapFile } from '#commands/all/recap/lib/writeRecapFile.ts'
import CommandContext from '#commands/lib/core/CommandContext.ts'
import CommandService from '#commands/lib/core/CommandService.ts'
import { getDarwinIdleMs, isCommandAvailable, runCommand } from '#lib/sys/mod.ts'
import type * as ConfigModule from '#shared/config.ts'
import { loadSkyConfig } from '#shared/config/loader.ts'
import { exists } from '#shared/fs/mod.ts'
import { dayDir, fetchNow } from '#shared/nbfs/mod.ts'
import { Instant, instantNow, PlainDate } from '#universal/dates/nbdt/mod.ts'
import { ReviewIdle } from './idle.ts'
import type { ReviewRuntime } from './types.ts'

export function createReviewRuntime(config: typeof ConfigModule, env: Record<string, string>): ReviewRuntime {
  const idle = new ReviewIdle(path.join(config.DIR_USER_DATA, 'state/day-review'))
  let sampling = false
  const sample = async () => {
    if (sampling) return
    sampling = true
    try {
      const [idleMs, clock] = await Promise.all([
        getDarwinIdleMs(),
        fetchNow({ timeDir: config.DIR_TIME }).catch(() => null),
      ])
      await idle.sample(
        Instant.from(instantNow()).epochMilliseconds,
        idleMs,
        clock?.plainDateTime.date ?? null,
        PlainDate.today().ymd,
        loadSkyConfig().dayReview?.idleHours ?? 5,
      )
    } catch (error) {
      console.warn('Day review idle check:', (error as Error).message)
    } finally {
      sampling = false
    }
  }
  void sample()
  setInterval(() => {
    void sample()
  }, 30_000).unref()
  const run = async (command: string, args: Record<string, unknown>) => {
    const tasks = new CommandService(CommandContext.server(config, env))
    const result = await tasks.run(command, args)
    if (result.status !== 'success') throw new Error(result.message ?? `${command} did not finish.`)
  }
  return {
    status: async () => ({
      ...(await idle.status()),
      ...(loadSkyConfig().dayReview?.idleHours === 0 ? { pending: null } : {}),
    }),
    acknowledge: (day) => idle.acknowledge(day),
    recap: async (id, ymd) => {
      const day = new PlainDate(ymd)
      if (await findRecapFile(day, id, config.DIR_TIME)) return 'Already saved.'
      if (
        id === 'codex' &&
        !(await exists(path.join(env.CODEX_HOME || path.join(config.DIR_HOME, '.codex'), 'sessions'))) &&
        !(await exists(path.join(env.CODEX_HOME || path.join(config.DIR_HOME, '.codex'), 'archived_sessions')))
      )
        return 'No Codex sessions on this computer.'
      if (id === 'claude-code' && !(await exists(path.join(config.DIR_HOME, '.claude', 'projects'))))
        return 'No Claude Code sessions on this computer.'
      if (id === 'github') {
        if (!(await isCommandAvailable('gh'))) return 'GitHub CLI is not connected.'
        if (!(await runCommand('gh', ['auth', 'status'])).success) return 'GitHub CLI is not signed in.'
      }
      await run(`recap:${id}`, { day, noEditor: true })
    },
    summarize: async (ymd) => {
      const day = new PlainDate(ymd)
      if (await exists(path.join(config.DIR_TIME, dayDir(day), 'summary.md'))) return
      await run('summary:day', { day, open: false })
    },
  }
}
