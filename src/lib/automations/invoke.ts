import type CommandService from '#commands/lib/core/CommandService.ts'
import type { ParamsRecord } from '#commands/lib/params.ts'
import transformTypedParamsArgs from '#commands/lib/transformTypedParamsArgs/mod.ts'
import type { PlainDateTime } from '#universal/dates/nbdt/mod.ts'

/** Charters contain raw YAML; CommandService overrides must already be parsed. */
export async function resolveAutomationArgs(
  params: ParamsRecord,
  args: Record<string, unknown>,
  now: PlainDateTime,
): Promise<Record<string, unknown>> {
  const raw: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(args)) {
    const name = key.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
    // Relative dates belong to this firing's clock and are resolved on every run,
    // including morning jobs that precede day:start.
    raw[name] =
      params[name]?.type === 'plainDate' && (value === 'yesterday' || value === 'today')
        ? now.plainDate.addDays(value === 'yesterday' ? -1 : 0)
        : value
  }
  return transformTypedParamsArgs(params, { ...raw, _: [] }, { compositionDepth: 1 })
}

export async function invokeAutomation(
  service: CommandService,
  run: string,
  args: Record<string, unknown>,
  now: PlainDateTime,
) {
  const command = await service.get(run)
  const parsed = command.description.params ? await resolveAutomationArgs(command.description.params, args, now) : args
  return service.run(run, parsed)
}
