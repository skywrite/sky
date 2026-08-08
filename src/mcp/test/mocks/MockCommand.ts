/**
 * Mock task for testing MCP functionality
 */

import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { PlainDate, PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { MCPTool } from '../../decorators.ts'

/**
 * Simple mock task that echoes input
 */
const echoParams = {
  message: Arg.string('Message to echo'),
  uppercase: Flag.bool('Convert to uppercase', { default: false }),
  repeat: Flag.number('Number of times to repeat', { default: 1 }),
}

type EchoParams = InferParams<typeof echoParams>

@MCPTool()
export class MockEchoCommand extends Command {
  static override description: CommandDescription = {
    name: 'mock:echo',
    description: 'Mock task that echoes input',
    params: echoParams,
  }

  async run({ args, context }: CommandArgs<EchoParams>): Promise<CommandResult> {
    const { output } = context
    const { message, uppercase, repeat } = args

    let result = message
    if (uppercase) {
      result = result.toUpperCase()
    }

    const messages: string[] = []
    for (let i = 0; i < (repeat || 1); i++) {
      messages.push(result)
    }

    const finalMessage = messages.join(' ')
    output.log(finalMessage)

    return CommandResult.success({ echoed: finalMessage })
  }
}

/**
 * Mock task that simulates errors
 */
const errorParams = {
  type: Arg.string('Error type: fail, error, or throw'),
}

type ErrorParams = InferParams<typeof errorParams>

@MCPTool()
export class MockErrorCommand extends Command {
  static override description: CommandDescription = {
    name: 'mock:error',
    description: 'Mock task that throws errors',
    params: errorParams,
  }

  async run({ args }: CommandArgs<ErrorParams>): Promise<CommandResult> {
    const { type } = args

    switch (type) {
      case 'fail':
        return CommandResult.fail('This is a failure')
      case 'error':
        return CommandResult.error(new Error('This is an error'), 'Error occurred')
      case 'throw':
        throw new Error('This is a thrown error')
      default:
        return CommandResult.success({ message: 'Unknown error type' })
    }
  }
}

/**
 * Mock task with complex arguments
 */
const complexParams = {
  required: Arg.string('Required argument'),
  optional: Arg.string('Optional argument', { optional: true }),
  string: Flag.string('String flag'),
  number: Flag.number('Number flag'),
  boolean: Flag.bool('Boolean flag', { default: false }),
  array: Flag.string('Array flag (comma-separated)'),
  date: Flag.string('Date flag (ISO format)'),
}

type ComplexParams = InferParams<typeof complexParams>

@MCPTool({ name: 'mock_complex' })
export class MockComplexCommand extends Command {
  static override description: CommandDescription = {
    name: 'mock:complex',
    description: 'Mock task with complex arguments',
    params: complexParams,
  }

  async run({ args }: CommandArgs<ComplexParams>): Promise<CommandResult> {
    return CommandResult.success({ args: args })
  }
}

/**
 * Mock task with date params for testing rich schema generation
 */
const dateParams = {
  date: Arg.plainDate('Target date'),
  when: Flag.plainDateTime('When to schedule', { default: () => PlainDateTime.fromString('2026-02-12 09:00') }),
  hidden: Flag.string('Internal flag', { hidden: true }),
}

type DateParams = InferParams<typeof dateParams>

@MCPTool()
export class MockDateCommand extends Command {
  static override description: CommandDescription = {
    name: 'mock:date',
    description: 'Mock task with date parameters',
    params: dateParams,
  }

  async run({ args }: CommandArgs<DateParams>): Promise<CommandResult> {
    return CommandResult.success({ date: args.date?.toString(), when: args.when?.toString() })
  }
}

/**
 * Mock task without MCP decorator (should not be discovered)
 */
export class MockNonMCPCommand extends Command {
  static override description: CommandDescription = {
    name: 'mock:non-mcp',
    description: 'Mock task without MCP decorator',
  }

  async run(): Promise<CommandResult> {
    return CommandResult.success({ message: 'This should not be exposed via MCP' })
  }
}
