/**
 * MCP Server for Notebook Tasks
 *
 * This server exposes decorated notebook tasks as MCP tools,
 * allowing Claude to execute tasks like meeting:new directly.
 */

import { Command, CommandResult } from '#commands/mod.ts'
import CommandContext from '#commands/lib/core/CommandContext.ts'
import CommandService from '#commands/lib/core/CommandService.ts'
import { Server } from '@modelcontextprotocol/sdk/server'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { getMCPToolOptions, isMCPTool } from './decorators.ts'
import { findMCPDecoratedCommands } from './discovery.ts'
import {
  commandDescriptionToMCPSchema,
  commandNameToMCPToolName,
  mcpArgsToCommandArgs,
  mcpToolNameToCommandName,
} from './adapter.ts'
import type { CommandArgs, CommandDescription } from '#commands/lib/commands.d.ts'
import { BufferedOutput } from '#commands/lib/output/BufferedOutput.ts'
import * as config from '#config'
import { env } from '#shared/sys/mod.ts'

// Type for concrete Command class constructors with static properties
type CommandConstructor = {
  new (): Command
  description: CommandDescription
}

interface MCPCommandInfo {
  commandName: string
  commandClass: CommandConstructor
  commandDescription: CommandDescription
  mcpToolName: string
}

class NotebookMCPServer {
  private server: Server
  private tasks: Map<string, MCPCommandInfo> = new Map()

  constructor() {
    this.server = new Server(
      {
        name: 'notebook-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      },
    )

    this.setupHandlers()
  }

  private setupHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = Array.from(this.tasks.values()).map((taskInfo) => ({
        name: taskInfo.mcpToolName,
        description: taskInfo.commandDescription.description,
        inputSchema: commandDescriptionToMCPSchema(taskInfo.commandDescription),
      }))

      return { tools }
    })

    // Execute a tool
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name: toolName, arguments: args } = request.params

      const taskInfo = this.tasks.get(toolName)
      if (!taskInfo) {
        throw new Error(`Unknown tool: ${toolName}`)
      }

      try {
        // Get the task class (which extends Command)
        const CommandClass = taskInfo.commandClass
        // Create task instance
        const commandInstance = new CommandClass()

        // Prepare CommandArgs
        const output = new BufferedOutput()
        const cliArgs = await mcpArgsToCommandArgs(args || {}, taskInfo.commandDescription)

        // Include EDITOR from current environment
        const envObj = env.toObject()
        if (env.get('EDITOR')) {
          envObj.EDITOR = env.get('EDITOR')!
        }

        const context = CommandContext.test(config, { env: envObj }).fork({ output })
        const tasks = new CommandService(context, {}, { _: [] })
        const commandArgs: CommandArgs = {
          rawArgs: { _: [] },
          args: cliArgs,
          context,
          tasks,
        }

        // Execute task
        const result = await commandInstance.run(commandArgs)

        // Return result
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  status: result.status,
                  data: result.data,
                  message: result.message,
                  output: {
                    logs: output.getLogs(),
                    errors: output.getErrors(),
                  },
                },
                null,
                2,
              ),
            },
          ],
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error executing task: ${(error as Error).message}`,
            },
          ],
          isError: true,
        }
      }
    })
  }

  async discoverCommands() {
    // First, find only the files that have @MCPTool decorator
    const decoratedTaskPaths = await findMCPDecoratedCommands()

    console.error(`Found ${decoratedTaskPaths.length} files with @MCPTool decorator`)

    // Only import the files that actually have the decorator
    for (const fullPath of decoratedTaskPaths) {
      try {
        // Dynamic import - only imports files we know have the decorator
        const module = await import(`file://${fullPath}`)

        // Verify it has the decorator (double-check)
        if (module.default && isMCPTool(module.default)) {
          const CommandClass = module.default as CommandConstructor

          // Get task description from static property
          const commandDesc = CommandClass.description
          if (!commandDesc) continue

          const mcpOptions = getMCPToolOptions(CommandClass)
          const mcpToolName = mcpOptions?.name || commandNameToMCPToolName(commandDesc.name)

          this.tasks.set(mcpToolName, {
            commandName: commandDesc.name,
            commandClass: CommandClass,
            commandDescription: commandDesc,
            mcpToolName,
          })

          console.error(`Registered MCP tool: ${mcpToolName} (${commandDesc.name})`)
        }
      } catch (err) {
        console.error(`Failed to load task from ${fullPath}:`, (err as Error).message)
      }
    }

    console.error(`Registered ${this.tasks.size} MCP-enabled tasks`)
  }

  async start() {
    await this.discoverCommands()

    const transport = new StdioServerTransport()
    await this.server.connect(transport)
    console.error('MCP Server started on stdio transport')
  }
}

// Start the server
if (import.meta.main) {
  const server = new NotebookMCPServer()
  await server.start()
}
