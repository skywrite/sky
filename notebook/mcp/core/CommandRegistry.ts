/**
 * Task registry for managing MCP-enabled tasks
 */

import { Command, CommandDescription, CommandResult } from '#commands/mod.ts'
import { getMCPToolOptions, isMCPTool } from '../decorators.ts'
import { commandNameToMCPToolName } from '../adapter.ts'

export interface RegisteredCommand {
  commandName: string
  commandClass: typeof Command
  commandDescription: CommandDescription
  mcpToolName: string
}

export interface CommandDiscoveryOptions {
  /**
   * Paths to scan for tasks
   */
  paths?: string[]

  /**
   * Use file scanning instead of imports
   */
  useScan?: boolean

  /**
   * Custom task loader
   */
  loader?: (path: string) => Promise<any>
}

/**
 * Registry for MCP-enabled tasks
 */
export class CommandRegistry {
  private tasks = new Map<string, RegisteredCommand>()
  private discovered = false

  /**
   * Register a task class
   */
  register(CommandClass: typeof Command): void {
    if (!isMCPTool(CommandClass)) {
      throw new Error(`Task ${CommandClass.name} is not decorated with @MCPTool`)
    }

    const commandDescription = CommandClass.description
    if (!commandDescription) {
      throw new Error(`Task ${CommandClass.name} has no description`)
    }

    const mcpOptions = getMCPToolOptions(CommandClass)
    const mcpToolName = mcpOptions?.name || commandNameToMCPToolName(commandDescription.name)

    this.tasks.set(mcpToolName, {
      commandName: commandDescription.name,
      commandClass: CommandClass,
      commandDescription,
      mcpToolName,
    })
  }

  /**
   * Register multiple task classes
   */
  registerAll(CommandClasses: Array<typeof Command>): void {
    for (const CommandClass of CommandClasses) {
      if (isMCPTool(CommandClass)) {
        try {
          this.register(CommandClass)
        } catch (error) {
          console.error(`Failed to register task ${CommandClass.name}:`, error)
        }
      }
    }
  }

  /**
   * Get a task by MCP tool name
   */
  get(mcpToolName: string): RegisteredCommand | undefined {
    return this.tasks.get(mcpToolName)
  }

  /**
   * Get all registered tasks
   */
  getAll(): RegisteredCommand[] {
    return Array.from(this.tasks.values())
  }

  /**
   * Get all MCP tool names
   */
  getToolNames(): string[] {
    return Array.from(this.tasks.keys())
  }

  /**
   * Check if a tool is registered
   */
  has(mcpToolName: string): boolean {
    return this.tasks.has(mcpToolName)
  }

  /**
   * Clear all registered tasks
   */
  clear(): void {
    this.tasks.clear()
    this.discovered = false
  }

  /**
   * Get the number of registered tasks
   */
  size(): number {
    return this.tasks.size
  }

  /**
   * Discover tasks from the filesystem
   * This is a placeholder - the actual implementation would use
   * the discovery.ts module for file scanning
   */
  async discover(options: CommandDiscoveryOptions = {}): Promise<void> {
    if (this.discovered && !options.paths) {
      return // Already discovered
    }

    if (options.useScan) {
      // This would use the file scanning approach from discovery.ts
      // For now, we'll leave this as a placeholder
      console.error('File scanning discovery not yet implemented in CommandRegistry')
      return
    }

    // If specific paths are provided, load them
    if (options.paths && options.loader) {
      for (const path of options.paths) {
        try {
          const module = await options.loader(path)
          if (module.default && isMCPTool(module.default)) {
            this.register(module.default)
          }
        } catch (error) {
          console.error(`Failed to load task from ${path}:`, error)
        }
      }
    }

    this.discovered = true
  }

  /**
   * Create a CommandRegistry from an array of task classes (for testing)
   */
  static fromTasks(CommandClasses: Array<typeof Command>): CommandRegistry {
    const registry = new CommandRegistry()
    registry.registerAll(CommandClasses)
    return registry
  }
}
