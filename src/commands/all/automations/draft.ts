import { generateObject } from 'ai'
import colors from 'picocolors'
import { z } from 'zod'
import { getManifest } from '#commands/all/cli/_commandsManifest.ts'
import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DIR_AUTOMATIONS } from '#config'
import { aiModel } from '#shared/ai/models.ts'
import { readTextFile } from '#shared/fs/mod.ts'
import { loadAutomationDir } from '#shared/models/Automation/loadAutomationDir.ts'
import Automation from '#shared/models/Automation/mod.ts'
import { describeTrigger, frameOf } from '#shared/models/Automation/trigger.ts'
import { readPromptFile } from '#shared/prompts/load.ts'
import { type RenderInput, renderPromptFile } from '#shared/prompts/mod.ts'

const SYSTEM_PROMPT_FILE = new URL('./prompts/draft.prompt.md', import.meta.url).pathname

/** kebab-case, so the file name never needs quoting anywhere */
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/

const params = {
  request: Arg.string('What the automation should take care of, in your own words'),
  revise: Flag.string('Rewrite this existing charter instead of drafting a new one', { optional: true }),
  json: Flag.bool('Output as JSON', { default: false }),
}

type Params = InferParams<typeof params>

type Result = {
  name: string
  /** The complete charter file, validated but not written */
  contents: string
  run: string
  trigger: string
  frame: string
  brief: string
  revised: boolean
}

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'automations:draft': {
      params: Params
      result: Result
    }
  }
}

const DraftSchema = z.object({
  name: z.string().describe('kebab-case charter file name, without .md'),
  contents: z.string().describe('the complete charter file: frontmatter and the brief body'),
})

/**
 * Why a draft cannot be accepted, or null. The same gate guards a retry and the
 * final answer, so nothing invalid ever leaves this command.
 */
export function validateCharterDraft(
  name: string,
  contents: string,
  options: { commandNames: Set<string>; existingNames: Set<string>; revising: boolean },
): string | null {
  if (!options.revising) {
    if (!NAME_RE.test(name)) return `name "${name}" is not kebab-case (letters, digits, dashes)`
    if (options.existingNames.has(name)) return `a charter named "${name}" already exists`
  }

  let automation: Automation
  try {
    automation = Automation.fromMarkdown(contents, name)
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }

  if (automation.unknownKeys.length) {
    return `frontmatter keys nothing reads: ${automation.unknownKeys.join(', ')}`
  }
  if (!options.commandNames.has(automation.run)) {
    return `run: ${automation.run} is not a command in the catalog`
  }
  return null
}

export default class AutomationsDraftTask extends Command {
  static override description: CommandDescription = {
    name: 'automations:draft',
    description: 'Have the model draft an automation charter from a plain-words request. Writes nothing.',
    descriptionLong: [
      'Turns "every weekday at 7, brief me on my day" into a complete, validated',
      'charter file — run:, a trigger, and a brief in your voice — grounded in the',
      'real command catalog so it can never name a command that does not exist.',
      'With --revise it rewrites an existing charter to satisfy the request',
      'instead. The draft is returned, never written: approving it is a separate',
      'step, on the web page or by saving the file yourself.',
    ],
    usage: [
      'sky automations:draft "every weekday at 7, start my day"',
      'sky automations:draft "skip fridays" --revise morning-brief',
    ],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    const { request, revise, json } = args

    const manifest = await getManifest()
    const entries = [...manifest.commands.core, ...manifest.commands.local, ...manifest.commands.global]
    const commandNames = new Set(entries.map((entry) => entry.name))
    const catalog = entries
      .map((entry) => {
        const flags = entry.flags.length ? ` [flags: ${entry.flags.map((flag) => flag.name).join(', ')}]` : ''
        return `- ${entry.name} — ${entry.description}${flags}`
      })
      .join('\n')

    const { byName } = await loadAutomationDir(DIR_AUTOMATIONS)
    const existingNames = new Set(byName.keys())

    let current: string | undefined
    if (revise !== undefined) {
      const entry = byName.get(revise)
      if (!entry) {
        const known = [...existingNames].sort().join(', ')
        return CommandResult.fail(
          known ? `No charter named "${revise}". Declared: ${known}` : `No charter named "${revise}"`,
        )
      }
      current = await readTextFile(entry.path)
    }

    const renderInput: RenderInput = {
      context: {
        systemDate: context.systemNow.date,
        systemTime: context.systemNow.time,
      },
      draft: {
        existing: existingNames.size ? [...existingNames].sort().join(', ') : '(none)',
        catalog,
      },
    }
    const { output: systemPrompt } = renderPromptFile(
      await readPromptFile(SYSTEM_PROMPT_FILE),
      'draft.prompt.md',
      renderInput,
    )

    const basePrompt =
      revise !== undefined
        ? [
            'Revise the charter below to satisfy this request. Change only what the request',
            `touches. Keep created:, set updated: to today. The file name stays "${revise}".`,
            '',
            `Request: ${request}`,
            '',
            `Current charter (automations/${revise}.md):`,
            '',
            current,
          ].join('\n')
        : `Write a new automation charter for this request:\n\n${request}`

    // Two attempts: the validator's complaint rides back into the second, and
    // nothing invalid ever leaves — the same rule the trigger parser lives by.
    let name = ''
    let contents = ''
    let problem: string | null = 'the model returned nothing'
    let prompt = basePrompt
    for (let attempt = 0; attempt < 2 && problem; attempt++) {
      let object: z.infer<typeof DraftSchema>
      try {
        const result = await generateObject({
          ...aiModel('balanced'),
          schema: DraftSchema,
          instructions: systemPrompt,
          prompt,
        })
        object = result.object
      } catch (err) {
        return CommandResult.error(err as Error, 'The draft model call failed')
      }

      name = revise ?? object.name
      contents = object.contents
      problem = validateCharterDraft(name, contents, { commandNames, existingNames, revising: revise !== undefined })
      if (problem) {
        prompt = `${basePrompt}\n\nYour previous draft was rejected: ${problem}\n\nPrevious draft:\n\n${contents}\n\nReturn a corrected charter.`
      }
    }
    if (problem) {
      return CommandResult.fail(`The draft did not validate: ${problem}`)
    }

    const automation = Automation.fromMarkdown(contents, name)
    const result: Result = {
      name,
      contents,
      run: automation.run,
      trigger: describeTrigger(automation.trigger),
      frame: frameOf(automation.trigger),
      brief: automation.brief,
      revised: revise !== undefined,
    }

    if (json) {
      output.log(JSON.stringify(result))
    } else {
      output.log(colors.bold(`automations/${name}.md`))
      output.log('')
      output.log(contents.trimEnd())
      output.log('')
      output.log(colors.dim('Nothing written — approve it on /automations, or save the file yourself.'))
    }

    return CommandResult.success(result)
  }
}
