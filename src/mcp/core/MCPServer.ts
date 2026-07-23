/**
 * Unified MCP Server that combines all components
 */

import type { Transport } from './Transport.ts'
import { type MCPCapabilities, MCPCore, type MCPServerInfo } from './MCPCore.ts'
import { CommandRegistry } from './CommandRegistry.ts'
import { ToolExecutor } from './ToolExecutor.ts'
import { commandDescriptionToMCPSchema } from '../adapter.ts'

export interface MCPServerOptions {
  /**
   * Server information
   */
  serverInfo?: MCPServerInfo

  /**
   * Server capabilities
   */
  capabilities?: MCPCapabilities

  /**
   * Custom task registry
   */
  commandRegistry?: CommandRegistry

  /**
   * Custom tool executor
   */
  toolExecutor?: ToolExecutor

  /**
   * Environment variables for task execution
   */
  env?: Record<string, string>
}

/**
 * Complete MCP Server implementation
 */
export class MCPServer {
  private core: MCPCore
  private registry: CommandRegistry
  private executor: ToolExecutor
  private transport?: Transport
  private running = false

  constructor(options: MCPServerOptions = {}) {
    // Initialize server info
    const serverInfo = options.serverInfo || {
      name: 'notebook-mcp',
      version: '1.0.0',
    }

    // Initialize capabilities
    const capabilities = options.capabilities || {
      tools: {},
    }

    // Initialize components
    this.core = new MCPCore(serverInfo, capabilities)
    this.registry = options.commandRegistry || new CommandRegistry()
    this.executor = options.toolExecutor || ToolExecutor.create(options.env)

    // Setup MCP handlers
    this.setupHandlers()
  }

  /**
   * Setup MCP protocol handlers
   */
  private setupHandlers(): void {
    // Handle tools/list request
    this.core.registerHandler('tools/list', async () => {
      // WORKAROUND: Claude may request tools/list immediately after initialize
      // without sending notifications/initialized due to a bug.
      // We allow this request even if not technically initialized per spec.
      console.log('[MCPServer] Handling tools/list request')

      const tasks = this.registry.getAll()
      const tools = tasks.map((task) => ({
        name: task.mcpToolName,
        description: task.commandDescription.description,
        inputSchema: commandDescriptionToMCPSchema(task.commandDescription),
      }))

      console.log(`[MCPServer] Returning ${tools.length} tools`)
      return { tools }
    })

    // Handle tools/call request
    this.core.registerHandler('tools/call', async (request) => {
      const { name: toolName, arguments: args } = request.params

      // Get the task
      const task = this.registry.get(toolName)
      if (!task) {
        throw this.core.createError(-32602, `Unknown tool: ${toolName}`)
      }

      // Validate arguments
      const validation = this.executor.validateArguments(task, args || {})
      if (!validation.valid) {
        throw this.core.createError(-32602, 'Invalid arguments', { errors: validation.errors })
      }

      try {
        // Execute the task
        const result = await this.executor.execute(task, args || {})

        // Return MCP response with structured content
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
          structuredContent: result,
          isError: result.status === 'error',
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

  /**
   * Start the server with a transport
   */
  async start(transport: Transport): Promise<void> {
    if (this.running) {
      throw new Error('Server is already running')
    }

    // Connect transport
    await transport.connect()

    // Attach core to transport
    await this.core.attach(transport)

    this.transport = transport
    this.running = true
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return
    }

    if (this.transport) {
      await this.transport.close()
      this.transport = undefined
    }

    this.running = false
    this.core.reset()
  }

  /**
   * Register a task with the server
   */
  registerCommand(CommandClass: typeof import('#commands/lib/core/Command.ts').Command): void {
    this.registry.register(CommandClass)
  }

  /**
   * Register multiple tasks
   */
  registerCommands(CommandClasses: Array<typeof import('#commands/lib/core/Command.ts').Command>): void {
    this.registry.registerAll(CommandClasses)
  }

  /**
   * Discover tasks from filesystem
   */
  async discoverCommands(options?: Parameters<CommandRegistry['discover']>[0]): Promise<void> {
    await this.registry.discover(options)
  }

  /**
   * Get the task registry
   */
  getRegistry(): CommandRegistry {
    return this.registry
  }

  /**
   * Get the tool executor
   */
  getExecutor(): ToolExecutor {
    return this.executor
  }

  /**
   * Get the MCP core
   */
  getCore(): MCPCore {
    return this.core
  }

  /**
   * Check if server is running
   */
  isRunning(): boolean {
    return this.running
  }

  /**
   * Create a server with mock tasks for testing
   */
  static createForTesting(CommandClasses: Array<typeof import('#commands/lib/core/Command.ts').Command>): MCPServer {
    const server = new MCPServer({
      serverInfo: {
        name: 'test-mcp',
        version: '1.0.0',
      },
    })

    server.registerCommands(CommandClasses)
    return server
  }
}
