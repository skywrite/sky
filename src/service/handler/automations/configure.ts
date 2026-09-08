import { parseDocument, stringify } from 'yaml'
import { z } from 'zod'
import type { CommandEntry, CommandsManifest } from '#commands/all/cli/_commandsManifest.ts'
import Automation from '#shared/models/Automation/mod.ts'
import { describeTrigger, frameOf } from '#shared/models/Automation/trigger.ts'
import type { PlainDate } from '#universal/dates/nbdt/mod.ts'
import type { DraftReport } from './mod.ts'

export type AutomationCommand = Pick<CommandEntry, 'name' | 'description' | 'flags'> & {
  source: 'core' | 'local' | 'global'
}

/** Match commandLoader's precedence without sending filesystem paths to the client. */
export function automationCommands(manifest: CommandsManifest): AutomationCommand[] {
  const commands = new Map<string, AutomationCommand>()
  for (const source of ['local', 'global', 'core'] as const) {
    for (const { name, description, flags } of manifest.commands[source]) {
      if (!commands.has(name)) commands.set(name, { name, description, flags, source })
    }
  }
  return [...commands.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export const AutomationSetupSchema = z
  .object({
    commands: z
      .array(
        z.object({
          run: z.string().trim().min(1),
          name: z.string().trim().optional(),
          args: z.record(z.string(), z.unknown()).default({}),
          template: z.string().optional(),
        }),
      )
      .min(1)
      .max(50),
    at: z.union([z.string(), z.array(z.string()).min(1)]).optional(),
    every: z.string().optional(),
    tz: z.string().optional(),
    until: z.string().optional(),
    brief: z.string().optional(),
    revise: z.string().optional(),
  })
  .strict()

export type AutomationSetup = z.infer<typeof AutomationSetupSchema>

export const argumentKey = (name: string): string =>
  name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())

export function setupFromCharter(name: string, contents: string): AutomationSetup {
  const automation = Automation.fromMarkdown(contents, name)
  const { trigger } = automation
  return {
    commands: [{ name, run: automation.run, args: automation.args }],
    ...(trigger.kind === 'every'
      ? { every: trigger.raw }
      : { at: trigger.times.map((time) => time.raw), ...(trigger.zone ? { tz: trigger.zone } : {}) }),
    until: automation.until?.ymd,
    brief: automation.brief,
    revise: name,
  }
}

/** Continue from an unsaved proposal, including its prose and untouched metadata. */
export function setupFromDraft(draft: Pick<DraftReport, 'name' | 'contents' | 'revised'>): AutomationSetup {
  const setup = setupFromCharter(draft.name, draft.contents)
  setup.commands[0]!.template = draft.contents
  if (!draft.revised) delete setup.revise
  return setup
}

function checkedArgs(command: AutomationCommand, args: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(args)) {
    const flag = command.flags.find((candidate) => argumentKey(candidate.name) === argumentKey(key))
    if (!flag) throw new Error(`${command.name} has no argument named ${key}.`)
    const valid =
      flag.type === 'bool'
        ? typeof value === 'boolean'
        : flag.type === 'number'
          ? typeof value === 'number' && Number.isFinite(value)
          : flag.type === 'stringOrBool'
            ? typeof value === 'string' || typeof value === 'boolean'
            : typeof value === 'string'
    if (!valid) throw new Error(`${command.name}: ${key} needs a ${flag.type} value.`)
    normalized[argumentKey(flag.name)] = value
  }
  return normalized
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?=\r?\n|$)/

/** Deterministic, read-only proposals. Each selected command keeps its own scheduler ledger. */
export function configureAutomations(
  setup: AutomationSetup,
  options: {
    commands: AutomationCommand[]
    existingNames: Set<string>
    today: PlainDate
    current?: { name: string; contents: string }
  },
): DraftReport[] {
  const { current, today } = options
  if (setup.revise && (!current || current.name !== setup.revise)) throw new Error('The automation no longer exists.')
  if (setup.revise && setup.commands.length !== 1) throw new Error('An existing automation runs one command.')
  const reserved = new Set(options.existingNames)
  return setup.commands.map((selection) => {
    const command = options.commands.find((candidate) => candidate.name === selection.run)
    if (!command) throw new Error(`Command ${selection.run} is not in the catalog.`)
    let name = current?.name ?? selection.name?.trim()
    if (!name) {
      const base =
        selection.run
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '') || 'automation'
      name = base
      for (let suffix = 2; reserved.has(name); suffix++) name = `${base}-${suffix}`
    }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error('Use letters, digits and dashes for the automation name.')
    if (!current && reserved.has(name)) throw new Error(`An automation named ${name} already exists.`)
    reserved.add(name)

    const args = checkedArgs(command, selection.args)
    const fields: Record<string, unknown> = {
      run: command.name,
      at: setup.at,
      every: setup.every,
      tz: setup.tz || undefined,
      until: setup.until || undefined,
      args: Object.keys(args).length ? args : undefined,
    }
    let contents: string
    const original = selection.template ?? current?.contents
    if (original !== undefined) {
      Automation.fromMarkdown(original, name)
      const match = FRONTMATTER.exec(original)
      if (!match) throw new Error('The charter has no frontmatter.')
      const yaml = parseDocument(match[1]!)
      if (yaml.errors.length) throw new Error(yaml.errors[0]!.message)
      const oldFields = yaml.toJS() as Record<string, unknown>
      for (const [key, value] of Object.entries({ ...fields, updated: today.ymd })) {
        if (value === undefined) yaml.delete(key)
        else if (JSON.stringify(oldFields[key]) !== JSON.stringify(value)) yaml.set(key, value)
      }
      const oldBody = original.slice(match[0].length)
      const body = setup.brief === undefined || setup.brief === oldBody.trim() ? oldBody : `\n\n${setup.brief.trim()}\n`
      contents = `---\n${yaml.toString()}---${body}`
    } else {
      const yaml = Object.fromEntries(
        Object.entries({ ...fields, status: 'active', created: today.ymd }).filter(([, value]) => value !== undefined),
      )
      const brief = setup.brief?.trim() || command.description
      contents = `---\n${stringify(yaml)}---\n\n${brief}\n`
    }
    const automation = Automation.fromMarkdown(contents, name)
    return {
      name,
      contents,
      run: automation.run,
      trigger: describeTrigger(automation.trigger),
      frame: frameOf(automation.trigger),
      brief: automation.brief,
      revised: !!current,
      args: automation.args,
      until: automation.until?.ymd,
    }
  })
}
