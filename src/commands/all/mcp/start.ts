import { spawn } from 'node:child_process'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'

const params = {
  stdio: Flag.boolean('Use stdio transport (default)', { default: true }),
  port: Flag.number('Port for HTTP transport (future)', { default: 3000 }),
}

type Params = InferParams<typeof params>

export default class MCPStartTask extends Command {
  static override description: CommandDescription = {
    name: 'mcp:start',
    description: 'Start the MCP server for notebook tasks',
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult> {
    const { output } = context
    const { stdio } = args

    if (!stdio) {
      return CommandResult.fail('Only stdio transport is currently supported')
    }

    output.log('Starting MCP server on stdio transport...')
    output.log('')
    output.log('To use with Claude Desktop:')
    output.log('1. Run this command and pipe to a file:')
    output.log('   sky mcp:start 2>/dev/null')
    output.log('')
    output.log('2. Add to Claude Desktop MCP settings:')
    output.log('   {')
    output.log('     "mcpServers": {')
    output.log('       "notebook": {')
    output.log('         "command": "sky",')
    output.log('         "args": ["mcp:start"]')
    output.log('       }')
    output.log('     }')
    output.log('   }')
    output.log('')
    output.log('Starting server...')

    // Run the MCP server
    const serverPath = new URL('../../mcp/server.ts', import.meta.url).pathname

    try {
      const child = spawn('deno', ['run', '--allow-all', serverPath], {
        stdio: 'inherit',
      })

      // Wait for the process to complete (it won't unless killed)
      await new Promise<void>((resolve, reject) => {
        child.on('close', () => resolve())
        child.on('error', reject)
      })

      return CommandResult.success()
    } catch (error) {
      return CommandResult.error(error as Error, 'Failed to start MCP server')
    }
  }
}
