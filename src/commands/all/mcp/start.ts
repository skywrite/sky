/**
 * A worked example of reaching Sky's commands from outside Sky.
 *
 * Starts an MCP server on stdio, so an external assistant — Claude Desktop,
 * ChatGPT, or anything else that speaks the Model Context Protocol — can call
 * Sky commands as tools. The commands offered are the ones tagged `@MCPTool()`
 * (`meeting:new`, `message:new`, `email:new`, `event:new`, `video:new`,
 * `slack:new`); tagging a command is the whole opt-in.
 *
 * This exists to demonstrate the wiring, not as a supported product surface.
 * Nothing about normal Sky use depends on it.
 */

import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { main as runMCPServer } from '#mcp/server.ts'

const params = {
  stdio: Flag.bool('Use stdio transport (default)', { default: true }),
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

    // Every line below goes to stderr. Once the server is up, stdout carries
    // JSON-RPC and nothing else — a single stray human-readable line there is
    // a parse error for whichever client is attached.
    output.error('Starting MCP server on stdio transport...')
    output.error('')
    output.error('To use with Claude Desktop, add to its MCP settings:')
    output.error('   {')
    output.error('     "mcpServers": {')
    output.error('       "notebook": {')
    output.error('         "command": "sky",')
    output.error('         "args": ["mcp:start"]')
    output.error('       }')
    output.error('     }')
    output.error('   }')
    output.error('')

    try {
      // Run in-process rather than spawning a runtime: the server is ordinary
      // TypeScript, and a child process only added a dependency on whichever
      // runtime happened to be named here.
      await runMCPServer()
      return CommandResult.success()
    } catch (error) {
      return CommandResult.error(error as Error, 'Failed to start MCP server')
    }
  }
}
