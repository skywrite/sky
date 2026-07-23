/**
 * Tool executor for running MCP tasks
 */

import { Command, type CommandArgs, CommandResult } from '#commands/mod.ts'
import CommandContext from '#commands/lib/core/CommandContext.ts'
import CommandService from '#commands/lib/core/CommandService.ts'
import type { RegisteredCommand } from './CommandRegistry.ts'
import { BufferedOutput } from '#commands/lib/output/BufferedOutput.ts'
import { mcpArgsToCommandArgs } from '../adapter.ts'
import * as config from '#config'
import { env } from '#shared/sys/mod.ts'

export interface ExecutionResult {
  status: 'success' | 'fail' | 'error'
  data?: any
  message?: string
  output?: {
    logs: string[]
    errors: string[]
  }
}

export interface ExecutionOptions {
  /**
   * Custom environment variables
   */
  env?: Record<string, string>

  /**
   * Timeout in milliseconds
   */
  timeout?: number

  /**
   * Custom output handler
   */
  output?: BufferedOutput
}

/**
 * Executes MCP tools (tasks)
 */
export class ToolExecutor {
  constructor(private defaultEnv: Record<string, string> = {}) {}

  /**
   * Execute a tool with the given arguments
   */
  async execute(
    task: RegisteredCommand,
    args: Record<string, any> = {},
    options: ExecutionOptions = {},
  ): Promise<ExecutionResult> {
    try {
      // Create task instance
      const CommandClass = task.commandClass as any
      const commandInstance = new CommandClass()

      // Prepare output handler
      const output = options.output || new BufferedOutput()

      // Convert MCP arguments to task arguments
      const cliArgs = await mcpArgsToCommandArgs(args, task.commandDescription)

      // Merge environment variables
      const envObj = {
        ...env.toObject(),
        ...this.defaultEnv,
        ...options.env,
      }

      // Prepare CommandArgs
      const context = CommandContext.test(config, { env: envObj }).fork({ output })
      const tasks = new CommandService(context, {}, { _: [] })
      const commandArgs: CommandArgs = {
        rawArgs: { _: [] },
        args: cliArgs,
        context,
        tasks,
      }

      // Execute with optional timeout
      let result: CommandResult

      if (options.timeout) {
        result = await this.executeWithTimeout(commandInstance.run(commandArgs), options.timeout)
      } else {
        result = await commandInstance.run(commandArgs)
      }

      // Convert CommandResult to ExecutionResult
      return {
        status: result.status,
        data: result.data,
        message: result.message,
        output: {
          logs: output.getLogs(),
          errors: output.getErrors(),
        },
      }
    } catch (error) {
      // Handle thrown errors
      return {
        status: 'error',
        message: `Task execution failed: ${(error as Error).message}`,
        output: {
          logs: [],
          errors: [(error as Error).message],
        },
      }
    }
  }

  /**
   * Execute with timeout
   */
  private async executeWithTimeout<T>(promise: Promise<T>, timeout: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`Execution timed out after ${timeout}ms`)), timeout),
      ),
    ])
  }

  /**
   * Validate that required arguments are present
   */
  validateArguments(task: RegisteredCommand, args: Record<string, any>): { valid: boolean; errors: string[] } {
    const errors: string[] = []
    const commandDesc = task.commandDescription

    // Check required params
    if (commandDesc.params) {
      for (const [name, param] of Object.entries(commandDesc.params)) {
        // Required if not optional and no default
        const isRequired = !param.optional && param.default === undefined
        if (isRequired && !(name in args)) {
          errors.push(`Missing required parameter: ${name}`)
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    }
  }

  /**
   * Extract flag name from definition
   */
  private extractFlagName(flagDef: string): string {
    const longFlag = flagDef.match(/--([a-zA-Z0-9-]+)/)
    if (longFlag) {
      return longFlag[1].replace(/-/g, '_')
    }

    const shortFlag = flagDef.match(/-([a-zA-Z])/)
    return shortFlag ? shortFlag[1] : flagDef
  }

  /**
   * Create a ToolExecutor with default environment
   */
  static create(customEnv?: Record<string, string>): ToolExecutor {
    const defaultEnv = {
      EDITOR: env.get('EDITOR') || 'code',
      ...customEnv,
    }
    return new ToolExecutor(defaultEnv)
  }
}
