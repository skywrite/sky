import { Command, CommandResult, isError, isFail } from '#commands/mod.ts'
import colors from 'picocolors'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as config from '#config'
import { parsedArgs as args } from '#lib/sys/mod.ts'
import { env, exit } from '#shared/sys/mod.ts'
import { exists } from '#shared/fs/mod.ts'
import helpMessage from '#commands/lib/helpMessage.ts'
import transformTypedParamsArgs from '#commands/lib/transformTypedParamsArgs/mod.ts'
import type {
  CommandArgs,
  CommandDescription,
  CommandDescriptionCliPostProcessFunction,
} from '#commands/lib/commands.d.ts'
import CommandContext from '#commands/lib/core/CommandContext.ts'
import CommandService from '#commands/lib/core/CommandService.ts'
import { getManifest } from '#commands/all/cli/_commandsManifest.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

async function resolveCommandFile(input: string): Promise<string> {
  // First check manifest (supports core + local/global from commands.dirs)
  const commandName = input.replace(/\//g, ':')
  const manifest = await getManifest()
  const all = [...manifest.commands.local, ...manifest.commands.global, ...manifest.commands.core]
  const entry = all.find((c) => c.name === commandName)
  if (entry) return entry.file

  // Fallback: convention-based resolution from commands/all/
  const basePath = path.join(__dirname, 'all', input)
  const tsxFile = `${basePath}.tsx`
  if (await exists(tsxFile)) return tsxFile
  const modFile = path.join(basePath, 'mod.ts')
  if (await exists(modFile)) return modFile
  return `${basePath}.ts`
}

async function run() {
  const input = args._[0]
  const file = await resolveCommandFile(input as string)

  const commandMod = await import(file)

  // Check if this is a class-based command (default export extending Command)
  let commandDescription: CommandDescription
  let commandFn: (args: CommandArgs) => Promise<CommandResult>

  if (
    commandMod.default &&
    typeof commandMod.default === 'function' &&
    commandMod.default.prototype instanceof Command
  ) {
    // Class-based task - instantiate and use
    const TaskClass = commandMod.default
    const commandInstance = new TaskClass()
    commandDescription = TaskClass.description
    commandFn = (args: CommandArgs) => commandInstance.run(args)
  } else {
    console.error(colors.red(`\n  Command must export a class extending Command as default export.\n`))
    console.error(colors.gray(`  File: ${file}\n`))
    exit(1)
  }

  if (!commandDescription) {
    console.error(colors.red(`\n  Command does not have description.\n`))
    exit(1)
  }

  if (!commandDescription.name) {
    console.error(colors.red(`\n  Command does not have name.\n`))
    exit(1)
  }

  const commandName = commandDescription?.name
  const envObj = env.toObject()

  // Disable task name prefix for all tasks
  // const disablePrefix = commandName === 'cli:commands' || commandName === 'cli:flags'
  const disablePrefix = true

  // Create task execution context
  const context = CommandContext.console(config, envObj, commandName, disablePrefix)

  // Create task service for composition
  // Pass commandName so child tasks know their parent
  const commandService = new CommandService(context, {}, args, commandName)

  const commandArgs: CommandArgs = {
    args: {},
    context,
    tasks: commandService,
    rawArgs: args,
  }

  if (args.help || args.h) {
    const helpMesssage = helpMessage(commandDescription)
    console.log(helpMesssage)

    exit(0)
  }

  if (commandDescription) {
    if (commandDescription.params) {
      try {
        commandArgs.args = await transformTypedParamsArgs(commandDescription.params, args)
      } catch (_e) {
        const err = _e as Error
        throw new CommandRunnerError(err.message, err, commandDescription, args)
      }
    }
  }

  if (Array.isArray(commandDescription.postProcess)) {
    const postProcessFns = [...commandDescription.postProcess]
    while (postProcessFns.length > 0) {
      const fn = postProcessFns.shift() as CommandDescriptionCliPostProcessFunction
      const result = fn(commandArgs.args, args, commandDescription)
      if (result) {
        console.error(colors.red(`\n  ${result}\n`))
        exit(1)
      }
    }
  }

  if (!commandDescription) {
    console.warn(colors.magentaBright('\n  WARN: ') + 'Command does not have description may not have args set.\n')
  }

  if (!commandFn) {
    console.warn(colors.magentaBright('\n  WARN: ') + 'Command does not have a valid run function.\n')
  }

  // Log task start for top-level task
  context.output.commandStart?.()

  // Execute task with error handling wrapper
  let result: any
  try {
    result = await commandFn(commandArgs)
  } catch (error) {
    // Convert thrown errors to CommandResult.error
    const errorObj = error instanceof Error ? error : new Error(String(error))
    const taskResult = CommandResult.error(errorObj)

    // Log task failure
    context.output.commandEnd?.('error')

    console.error(colors.red(`\n  ERROR: ${taskResult.message}\n`))
    if (taskResult.error?.stack) {
      console.error(colors.gray(taskResult.error.stack))
    }
    exit(1)
  }

  // Check if task returned a CommandResult
  if (result && typeof result === 'object' && 'status' in result) {
    const taskResult = result as CommandResult

    // Handle different result statuses
    if (isError(taskResult)) {
      context.output.commandEnd?.('error')
      console.error(colors.red(`\n  ERROR: ${taskResult.message}\n`))
      if (taskResult.error?.stack) {
        console.error(colors.gray(taskResult.error.stack))
      }
      exit(1)
    } else if (isFail(taskResult)) {
      context.output.commandEnd?.('fail')
      console.error(colors.yellow(`\n  FAILED: ${taskResult.message}\n`))
      if (taskResult.data) {
        console.dir(taskResult.data)
      }
      exit(1)
    } else {
      // Success case - task ran successfully
      context.output.commandEnd?.('success')
    }
  } else if (result === undefined || result === null) {
    // Legacy task - assume success
    context.output.commandEnd?.('success')
    // Warn in development
    if (env.toObject().NODE_ENV !== 'production') {
      console.warn(colors.gray(`\n  Note: Command ${input} should return CommandResult.success()\n`))
    }
  }
}

class CommandRunnerError extends Error {
  public childError: Error
  public commandDesc: CommandDescription
  public args: Object

  constructor(message: string, childError: Error, commandDesc: CommandDescription, args: Object) {
    super(message)
    Object.setPrototypeOf(this, CommandRunnerError.prototype)

    this.name = 'CommandRunnerError'
    this.childError = childError
    this.commandDesc = commandDesc
    this.args = args
  }
}

function outputError(error: CommandRunnerError) {
  console.log('')

  console.group()
  console.log(colors.red('ERROR:'))
  console.group()
  console.log('')
  console.log(error.message)
  console.groupEnd()
  console.groupEnd()

  if (error?.commandDesc?.params) {
    console.group()
    console.log('')
    console.log(colors.cyan('Parameters:'))
    console.group()
    for (const [name, def] of Object.entries(error.commandDesc.params)) {
      const kind = def.kind === 'arg' ? 'arg' : def.kind === 'flag' ? 'flag' : 'arg/flag'
      console.log(colors.magenta(`${name}:`) + ` ${def.description} (${kind})`)
    }
    console.groupEnd()
    console.groupEnd()
  }

  console.log('')

  console.group()
  console.log(colors.yellow('Raw Arguments:'))
  console.group()
  console.log('')
  console.dir(error.args)
  console.groupEnd()
  console.groupEnd()

  console.log('')

  // Show stack trace without dumping entire error object (which includes verbose Zod schemas)
  if (error.childError?.stack) {
    console.error(colors.gray(error.childError.stack))
  }
}

try {
  await run()
} catch (err) {
  outputError(err as CommandRunnerError)
  exit(1)
}
