import { mkdir, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { loadAutomationDir } from '#shared/models/Automation/loadAutomationDir.ts'
import { withLock } from './files.ts'
import { OutboxError } from './types.ts'

export function outboxCharter(today: string): string {
  return `---
created: ${today}
updated: ${today}
kind: system
run: outbox:scan
every: 5m
status: active
---

Prepare replies that need my review in Outbox.

Start with today's saved Slack and email conversations, then process new or changed captures. Keep existing drafts across days. Ignore messages that need no response. Explain the situation, surface missing decisions, and shape grounded replies in my voice. Learn from my approved edits. Native drafts are placed only after review in Sky; sending stays in the native app.
`
}

export async function setupOutbox(
  dir: string,
  stateDir: string,
  today: string,
): Promise<{ created: boolean; name: string }> {
  return withLock(path.join(stateDir, 'setup.lock'), async () => {
    const { byName } = await loadAutomationDir(dir)
    const existing = [...byName.values()].find(({ automation }) => automation.run === 'outbox:scan')
    if (existing) return { created: false, name: existing.automation.name }
    if (byName.has('outbox'))
      throw new OutboxError('An automation named outbox already exists with another command.', 409)
    await mkdir(dir, { recursive: true })
    try {
      await writeFile(path.join(dir, 'outbox.md'), outboxCharter(today), { flag: 'wx', mode: 0o600 })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw new OutboxError('The outbox charter already exists. Review it in Automations.', 409)
      throw error
    }
    return { created: true, name: 'outbox' }
  })
}
