import * as path from 'node:path'
import Automation, { type AutomationCommandStep } from '#shared/models/Automation/mod.ts'
import { describeTrigger } from '#shared/models/Automation/trigger.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import type { AutomationRow, AutomationsRoutesOptions } from '../automations/mod.ts'

export const SLACK_CAPTURE_NAME = 'slack-capture'

export type SlackCaptureSettings = {
  name: string | null
  enabled: boolean
  minutes: number | null
  schedule: string
}

export type SlackCaptureChange = { enabled?: boolean; minutes?: number }

export type SlackCaptureHost = {
  read: () => Promise<SlackCaptureSettings>
  update: (change: SlackCaptureChange) => Promise<SlackCaptureSettings>
}

const COMMANDS: AutomationCommandStep[] = [
  { run: 'slack:saved', args: { captureAll: true } },
  { run: 'slack:todos', args: { captureAll: true } },
]

export function slackCaptureCharter(today: string, minutes = 5, enabled = true): string {
  return `---
created: ${today}
updated: ${today}
kind: system
commands:
  - run: slack:saved
    args:
      captureAll: true
  - run: slack:todos
    args:
      captureAll: true
every: ${minutes}m
status: ${enabled ? 'active' : 'paused'}
---

Capture my saved Slack messages and to-dos.

Run slack:saved --capture-all and slack:todos --capture-all. To-dos are added to today's Reminders. Each command keeps its existing capture and Slack completion behavior.
`
}

function isCapture(row: AutomationRow): boolean {
  return (
    row.commands?.length === COMMANDS.length &&
    COMMANDS.every((expected) =>
      row.commands!.some(
        (command) =>
          command.run === expected.run &&
          (command.args.captureAll === true || command.args['capture-all'] === true) &&
          Object.keys(command.args).every((key) => key === 'captureAll' || key === 'capture-all'),
      ),
    )
  )
}

/** Settings edits the ordinary charter; the existing scheduler owns execution, history and pause. */
export function createSlackCaptureHost(
  automations: AutomationsRoutesOptions,
  today = () => PlainDate.today().ymd,
  connected = () => true,
): SlackCaptureHost {
  const current = async () => {
    const report = await automations.status()
    const matches = report.rows.filter(isCapture)
    if (matches.length > 1)
      throw new Error('Several automations capture Saved and To-dos. Open Automations and keep one to configure here.')
    const named = report.rows.find((row) => row.name === SLACK_CAPTURE_NAME)
    const unreadable = report.charterErrors.find((error) => path.basename(error.path, '.md') === SLACK_CAPTURE_NAME)
    if ((named && !isCapture(named)) || unreadable)
      throw new Error(
        'The slack-capture automation has different commands or cannot be read. Review it in Automations.',
      )
    const row = matches[0]
    if (!row) return null
    const contents = await automations.readCharter?.(row.name)
    if (!contents) throw new Error('The Slack capture automation could not be read. Review it in Automations.')
    return { row, automation: Automation.fromMarkdown(contents, row.name) }
  }
  const read = async (): Promise<SlackCaptureSettings> => {
    const entry = await current()
    if (!entry) return { name: null, enabled: false, minutes: 5, schedule: 'every 5m' }
    const { row, automation } = entry
    const minutes = automation.trigger.kind === 'every' ? automation.trigger.intervalMs / 60_000 : null
    return {
      name: row.name,
      enabled: row.state === 'active',
      minutes,
      schedule: describeTrigger(automation.trigger),
    }
  }
  return {
    read,
    async update(change) {
      if (change.enabled && !connected()) throw new Error('Connect Slack before turning on automatic capture.')
      if (
        change.minutes !== undefined &&
        (!Number.isInteger(change.minutes) || change.minutes < 1 || change.minutes > 1440)
      )
        throw new Error('Choose a whole number of minutes between 1 and 1440.')
      const entry = await current()
      if (!entry) {
        if (change.enabled === false && change.minutes === undefined) return read()
        const result = await automations.create(
          SLACK_CAPTURE_NAME,
          slackCaptureCharter(today(), change.minutes ?? 5, change.enabled ?? false),
        )
        if (result.kind !== 'created')
          throw new Error(
            result.kind === 'invalid'
              ? result.message
              : 'The slack-capture automation already exists. Open Automations to review it.',
          )
      } else {
        const name = entry.row.name
        if (change.enabled && entry.row.state === 'expired')
          throw new Error(
            'The Slack capture automation has ended. Open Automations to change its end date before enabling it.',
          )
        if (change.minutes !== undefined) {
          const setup = await automations.configuration(name)
          if (!setup) throw new Error('The Slack capture automation no longer exists. Reload and try again.')
          const draft = await automations.preview({
            ...setup,
            every: `${change.minutes}m`,
            at: undefined,
            tz: undefined,
          })
          const result = await automations.save(name, draft.contents)
          if (result.kind !== 'saved')
            throw new Error(
              result.kind === 'invalid' ? result.message : 'The Slack capture automation no longer exists.',
            )
        }
        if (change.enabled !== undefined && !(await automations.setStatus(name, change.enabled ? 'active' : 'paused')))
          throw new Error('The Slack capture automation no longer exists. Reload and try again.')
      }
      return read()
    },
  }
}
