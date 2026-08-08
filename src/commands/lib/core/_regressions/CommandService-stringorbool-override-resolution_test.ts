/**
 * Regression: tasks.run overrides bypass the transform's stringOrBool
 * resolution. CommandService.run re-spreads raw overrides over the
 * transformed args ("parent tasks already have parsed values"), so a
 * composing caller's `server: true` reached run() as boolean true where the
 * command expects the resolved string — ai:chat's context pipeline crashed
 * with "server.startsWith is not a function" (2026-08-08).
 */

import { Command, type CommandArgs, type CommandDescription, CommandResult, Flag } from '#commands/mod.ts'
import * as config from '#config'
import { assert, test } from '#test'
import { BufferedOutput } from '../../output/BufferedOutput.ts'
import CommandContext from '../CommandContext.ts'
import CommandService from '../CommandService.ts'

class ServerEchoTask extends Command {
  static override description: CommandDescription = {
    name: 'test:server-echo',
    description: 'Echoes its stringOrBool server param',
    params: {
      server: Flag.stringOrBool('Service host', { short: 'S', bareValue: 'localhost:9999' }),
    },
  }

  async run({ args }: CommandArgs): Promise<CommandResult> {
    return CommandResult.success({ server: args['server'] ?? null })
  }
}

function createService(parentArgs: Record<string, unknown>): CommandService {
  const context = CommandContext.test(config).fork({ output: new BufferedOutput() })
  const service = new CommandService(context, parentArgs)
  Object.assign(service, { get: async () => ServerEchoTask as unknown as typeof Command })
  return service
}

test('stringOrBool override true resolves to bareValue through composition', async () => {
  // Parent merged args carry a boolean server default, like ai:context:files
  const service = createService({ server: false })

  const result = await service.run<{ server: unknown }>('test:server-echo', { server: true })

  assert({
    given: 'a composing caller passing server: true',
    should: 'hand run() the resolved bareValue string',
    actual: result.data?.server,
    expected: 'localhost:9999',
  })
})

test('stringOrBool override host string passes through composition', async () => {
  const service = createService({ server: false })

  const result = await service.run<{ server: unknown }>('test:server-echo', { server: '192.168.10.3' })

  assert({
    given: 'a composing caller passing a host string',
    should: 'hand run() the host unchanged',
    actual: result.data?.server,
    expected: '192.168.10.3',
  })
})

test('stringOrBool inherited false resolves to absent through composition', async () => {
  const service = createService({ server: false })

  const result = await service.run<{ server: unknown }>('test:server-echo', {})

  assert({
    given: "only the parent's inherited server: false (the original leak)",
    should: 'hand run() no server at all',
    actual: result.data?.server,
    expected: null,
  })
})
