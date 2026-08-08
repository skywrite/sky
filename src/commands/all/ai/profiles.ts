import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { getAllProfiles, PROFILES } from '#shared/ai/models.ts'

const params = {
  details: Flag.bool('Show provider, model, and options for each profile', {
    short: 'd',
    default: false,
  }),
}

type Params = InferParams<typeof params>
type Result = { profiles: string[] }

export default class AiProfilesTask extends Command {
  static override description: CommandDescription = {
    name: 'ai:profiles',
    description: 'List AI model profiles',
    descriptionLong: [
      'Lists the available model profiles.',
      'By default prints just the profile names in alphabetical order.',
      'Pass --details to also show each profile’s provider, model, and options.',
    ],
    usage: ['sky ai:profiles', 'sky ai:profiles --details'],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    const { details } = args

    const builtin = new Set(Object.keys(PROFILES))
    const entries = Object.entries(getAllProfiles()).sort(([a], [b]) => a.localeCompare(b))
    const names = entries.map(([name]) => name)

    if (!details) {
      output.log(names.join('\n'))
      return CommandResult.success({ profiles: names })
    }

    const blocks = entries.map(([name, profile]) => {
      const source = builtin.has(name) ? 'built-in' : 'custom'
      const opts =
        profile.options && Object.keys(profile.options).length > 0
          ? Object.entries(profile.options)
              .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
              .join(', ')
          : '(none)'
      return `${name}  (${source})\n  provider: ${profile.provider}\n  model:    ${profile.model}\n  options:  ${opts}`
    })

    output.log(blocks.join('\n\n'))
    return CommandResult.success({ profiles: names })
  }
}
