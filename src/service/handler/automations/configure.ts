import { isMap, isScalar, isSeq, parseDocument, stringify, YAMLMap, YAMLSeq } from 'yaml'
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
          args: z.record(z.string(), z.unknown()).default({}),
        }),
      )
      .min(1)
      .max(50),
    name: z.string().trim().optional(),
    template: z.string().optional(),
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
    name,
    commands: automation.commands,
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
  setup.template = draft.contents
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
const yamlKey = (key: unknown): unknown => (isScalar(key) ? key.value : key)

/** Move command nodes between the single and grouped forms without discarding their comments. */
function updateCommands(yaml: ReturnType<typeof parseDocument>, commands: AutomationSetup['commands']): void {
  if (!isMap(yaml.contents)) throw new Error('The charter frontmatter needs a mapping.')
  const previous = yaml.get('commands', true)
  const single = new YAMLMap(yaml.schema)
  single.items = yaml.contents.items.filter((pair) => ['run', 'args'].includes(String(yamlKey(pair.key))))
  const available: YAMLMap[] = isSeq(previous)
    ? previous.items.filter((entry): entry is YAMLMap => isMap(entry))
    : [single]
  const entries = commands.map(({ run, args }) => {
    const index = available.findIndex((entry) => entry.get('run') === run)
    const node: YAMLMap =
      index >= 0
        ? available.splice(index, 1)[0]!
        : !isSeq(previous) && commands.length === 1
          ? single
          : yaml.createNode({ run })
    node.set('run', run)
    const old = node.toJSON() as Record<string, unknown>
    if (!Object.keys(args).length) node.delete('args')
    else if (JSON.stringify(old.args) !== JSON.stringify(args)) node.set('args', yaml.createNode(args))
    return node
  })
  if (commands.length > 1) {
    const sequence = isSeq(previous) ? previous : new YAMLSeq(yaml.schema)
    sequence.items = entries
    yaml.delete('run')
    yaml.delete('args')
    yaml.set('commands', sequence)
  } else {
    const wrapper = yaml.contents.items.find((pair) => yamlKey(pair.key) === 'commands')
    const runKey = entries[0]!.items.find((pair) => yamlKey(pair.key) === 'run')?.key
    if (isScalar(runKey))
      runKey.commentBefore =
        [
          isScalar(wrapper?.key) ? wrapper.key.commentBefore : undefined,
          isSeq(previous) ? previous.commentBefore : undefined,
          entries[0]!.commentBefore,
          runKey.commentBefore,
        ]
          .filter(Boolean)
          .join('\n') || undefined
    yaml.delete('commands')
    for (const key of ['run', 'args']) {
      const pair = entries[0]!.items.find((entry) => yamlKey(entry.key) === key)
      const index = yaml.contents.items.findIndex((entry) => yamlKey(entry.key) === key)
      if (pair && index >= 0) yaml.contents.items[index] = pair
      else if (pair) yaml.contents.items.push(pair)
      else yaml.delete(key)
    }
  }
}

/** A selection is one automation with one schedule, file and run ledger. */
export function configureAutomation(
  setup: AutomationSetup,
  options: {
    commands: AutomationCommand[]
    existingNames: Set<string>
    today: PlainDate
    current?: { name: string; contents: string }
  },
): DraftReport {
  const { current, today } = options
  if (setup.revise && (!current || current.name !== setup.revise)) throw new Error('The automation no longer exists.')
  if (!setup.commands.length) throw new Error('Choose at least one command.')
  const commands = setup.commands.map((selection) => {
    const command = options.commands.find((candidate) => candidate.name === selection.run)
    if (!command) throw new Error(`Command ${selection.run} is not in the catalog.`)
    return { run: command.name, args: checkedArgs(command, selection.args) }
  })
  let name = current?.name ?? setup.name?.trim()
  if (!name) {
    const base =
      commands.length === 1
        ? commands[0]!.run
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')
        : commands.every((command) => command.run.startsWith('recap:'))
          ? 'morning-recaps'
          : 'automation'
    name = base || 'automation'
    for (let suffix = 2; options.existingNames.has(name); suffix++) name = `${base}-${suffix}`
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error('Use letters, digits and dashes for the automation name.')
  if (!current && options.existingNames.has(name)) throw new Error(`An automation named ${name} already exists.`)
  const fields: Record<string, unknown> = {
    run: commands.length === 1 ? commands[0]!.run : undefined,
    args: commands.length === 1 && Object.keys(commands[0]!.args).length ? commands[0]!.args : undefined,
    commands:
      commands.length > 1
        ? commands.map(({ run, args }) => ({ run, ...(Object.keys(args).length ? { args } : {}) }))
        : undefined,
    at: setup.at,
    every: setup.every,
    tz: setup.tz || undefined,
    until: setup.until || undefined,
  }
  let contents: string
  const original = setup.template ?? current?.contents
  if (original !== undefined) {
    Automation.fromMarkdown(original, name)
    const match = FRONTMATTER.exec(original)
    if (!match) throw new Error('The charter has no frontmatter.')
    const yaml = parseDocument(match[1]!)
    if (yaml.errors.length) throw new Error(yaml.errors[0]!.message)
    const oldFields = yaml.toJS() as Record<string, unknown>
    updateCommands(yaml, commands)
    for (const [key, value] of Object.entries({ ...fields, updated: today.ymd })) {
      if (['run', 'args', 'commands'].includes(key)) continue
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
    const brief =
      setup.brief?.trim() ||
      commands.map(({ run }) => options.commands.find((command) => command.name === run)!.description).join('\n')
    contents = `---\n${stringify(yaml)}---\n\n${brief}\n`
  }
  const automation = Automation.fromMarkdown(contents, name)
  return {
    name,
    contents,
    run: automation.run,
    commands: automation.commands,
    trigger: describeTrigger(automation.trigger),
    frame: frameOf(automation.trigger),
    brief: automation.brief,
    revised: !!current,
    args: automation.commands.length === 1 ? automation.commands[0]!.args : undefined,
    until: automation.until?.ymd,
  }
}
