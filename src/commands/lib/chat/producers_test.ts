import { spyOn } from 'bun:test'
import AIContextEvolveTask from '#commands/all/ai/context/evolve.ts'
import AIContextFilesTask from '#commands/all/ai/context/files.ts'
import CommandContext from '#commands/lib/core/CommandContext.ts'
import CommandService from '#commands/lib/core/CommandService.ts'
import { CommandResult } from '#commands/mod.ts'
import * as config from '#config'
import { assert, test } from '#test'
import { contextProducers } from './producers.ts'

test('chat context commands receive each new question over inherited arguments', async () => {
  const received: string[] = []
  class CaptureInitial extends AIContextFilesTask {
    override async run({ args }: Parameters<AIContextFilesTask['run']>[0]) {
      received.push(args.question)
      return CommandResult.success({ question: args.question, query: '{ days { id } }', paths: [], count: 0 })
    }
  }
  class CaptureEvolve extends AIContextEvolveTask {
    override async run({ args }: Parameters<AIContextEvolveTask['run']>[0]) {
      received.push(args.message)
      return CommandResult.success({ queries: ['{ meetings { id } }'], changed: true })
    }
  }

  const tasks = new CommandService(CommandContext.test(config), {
    _: ['test:parent', 'An earlier positional question'],
    question: 'An earlier named question',
    message: 'An earlier message',
  })
  const load = spyOn(tasks, 'get').mockImplementation(async (name) => {
    if (name === 'ai:context:files') return CaptureInitial
    if (name === 'ai:context:evolve') return CaptureEvolve
    throw new Error(`Unexpected command: ${name}`)
  })
  try {
    const producers = contextProducers(tasks)
    const initial = await producers.produceInitialQuery('Find Atlas notes')
    const evolved = await producers.evolveQueries('Include Atlas meetings', ['{ days { id } }'], [])
    assert({
      given: 'new questions on a service carrying earlier named and positional arguments',
      should: 'deliver the current question to both commands and return their query results',
      actual: { received, initial, evolved },
      expected: {
        received: ['Find Atlas notes', 'Include Atlas meetings'],
        initial: {
          ok: true,
          value: {
            paths: [],
            query: '{ days { id } }',
            truncations: undefined,
            since: undefined,
            until: undefined,
            start: undefined,
          },
        },
        evolved: { ok: true, value: { queries: ['{ meetings { id } }'], changed: true } },
      },
    })
  } finally {
    load.mockRestore()
  }
})
