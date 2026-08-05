/**
 * Scan task files for @MCPTool decorator without importing them
 */

import { join } from 'node:path'
import process from 'node:process'
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
  const tasksDir = join(process.cwd(), 'tasks', 'all')
  const decoratedTasks: string[] = []

  for await (const entry of walk(tasksDir, { exts: ['.ts'], includeDirs: false })) {
    if (entry.path.includes('_test.ts')) continue // Skip test files

    if (await hasMMCPToolDecorator(entry.path)) {
      decoratedTasks.push(entry.path)
    }
  }

  return decoratedTasks
}
