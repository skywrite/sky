import { mkdir, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { withLock } from '#lib/outbox/files.ts'
import { loadAutomationDir } from '#shared/models/Automation/loadAutomationDir.ts'

export function workstreamsCharter(today: string): string {
  return `---
created: ${today}
updated: ${today}
kind: system
run: workstreams:scan
every: 5m
status: active
---

Help keep the workstreams I have entrusted to Sky moving.

Review active workstreams when selected sources change, an agreed review is due, or a reporting cadence requires an update. Follow each workstream's current responsibility and limits. Prepare and verify delegated deliverables, make individually authorized decisions from evidence and explicit assumptions, and surface judgments outside that authority. A human-driven, paused, completed, or canceled workstream grants no scheduled work. Ordinary communications use Outbox review. Recurring reports may be delivered only under their separate exact audience and destination grant; record provider receipts and reconcile uncertain sends before any retry. This job never grants itself authority or infers sending from draft preparation.
`
}

/** Called by an explicit setup or responsibility action, never by importing the runtime. */
export async function setupWorkstreams(
  dir: string,
  stateDir: string,
  today: string,
): Promise<{ created: boolean; name: string }> {
  return withLock(path.join(stateDir, 'storage.lock'), () =>
    withLock(path.join(stateDir, 'setup.lock'), async () => {
      const managed = path.join(stateDir, 'automations')
      const { byName, errors } = await loadAutomationDir(dir, [managed])
      if (errors.length)
        throw new Error('Repair the unreadable or duplicate automation charters before enabling workstreams.')
      const existing = [...byName.values()].find(({ automation }) => automation.run === 'workstreams:scan')
      if (existing) return { created: false, name: existing.automation.name }
      if (byName.has('workstreams')) throw new Error('An automation named workstreams already runs another command.')
      await mkdir(managed, { recursive: true })
      try {
        await writeFile(path.join(managed, 'workstreams.md'), workstreamsCharter(today), { flag: 'wx', mode: 0o600 })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST')
          throw new Error('The workstreams charter already exists. Review it in Automations.')
        throw error
      }
      return { created: true, name: 'workstreams' }
    }),
  )
}
