/**
 * Scan task files for @MCPTool decorator without importing them
 */

import { walk } from '#shared/fs/mod.ts'
import readTextFile from '#shared/fs/readTextFile.ts'

/**
 * Scan a TypeScript file for @MCPTool decorator
 * Returns true if the file contains a decorated class
 */
async function hasMMCPToolDecorator(filePath: string): Promise<boolean> {
  try {
    const content = await readTextFile(filePath)
    // Look for @MCPTool decorator pattern
    // This regex matches @MCPTool or @MCPTool() or @MCPTool({ ... })
    const decoratorPattern = /@MCPTool\s*(?:\([^)]*\))?\s*(?:export\s+)?(?:default\s+)?class/
    return decoratorPattern.test(content)
  } catch {
    return false
  }
}

/**
 * Find all task files that have the @MCPTool decorator
 */
export async function findMCPDecoratedCommands(): Promise<string[]> {
  // Resolved from this module rather than the process's working directory:
  // `bin/sky` pushd's into src/ before running, so a cwd-relative path answers
  // to wherever the user happened to be standing.
  const commandsDir = new URL('../commands/all', import.meta.url).pathname
  const decoratedTasks: string[] = []

  for await (const entry of walk(commandsDir, { exts: ['.ts'], includeDirs: false })) {
    if (entry.path.includes('_test.ts')) continue // Skip test files

    if (await hasMMCPToolDecorator(entry.path)) {
      decoratedTasks.push(entry.path)
    }
  }

  return decoratedTasks
}
