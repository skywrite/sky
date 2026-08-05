#!/usr/bin/env -S deno run --allow-read

/**
 * Custom linter to check for console usage in task files
 *
 * This script checks all task files for direct console usage and reports
 * violations. Tasks should use the output handler instead.
 */

import colors from 'picocolors'
import { readTextFile, walk } from '#shared/fs/mod.ts'
import { exit } from '#shared/sys/mod.ts'

interface Violation {
  file: string
  line: number
  column: number
  text: string
  type: 'log' | 'error' | 'warn' | 'info' | 'debug' | 'dir' | 'table'
}

async function checkFile(filePath: string): Promise<Violation[]> {
  const violations: Violation[] = []
  const content = await readTextFile(filePath)
  const lines = content.split('\n')

  // Skip files that are allowed to use console
  const allowedPatterns = [
    /task-runner\.ts$/, // Task runner itself needs console
    /all\/lint\//, // Lint scripts need console
    /all\/service\/start\.ts$/, // Service entry point (no Task interface, uses --watch)
    /all\/releases\//, // Calendar visualization scripts run directly
    /all\/[^/]+\/_/, // Internal utility files (start with _) in task dirs
    /_migration\//, // Migration scripts can use console
    /_lib\//, // Library files might need console
    /_test\.ts$/, // Test files
    /test\//, // Test directories
    /ConsoleOutput\.ts$/, // Output handler itself uses console
    /tasks\/lib\//, // Task lib runs before output handlers exist
    /tasks\/_cli/, // CLI utilities run before output handlers exist
  ]

  if (allowedPatterns.some((pattern) => pattern.test(filePath))) {
    return violations
  }

  // Check each line for console usage
  const consolePattern = /console\.(log|error|warn|info|debug|dir|table)\(/

  lines.forEach((line, index) => {
    const match = line.match(consolePattern)
    if (match) {
      // Skip if it's in a comment
      const beforeConsole = line.substring(0, match.index!)
      const trimmedLine = line.trimStart()
      // Check for inline comments, block comment start, or JSDoc continuation
      if (
        beforeConsole.includes('//') ||
        beforeConsole.includes('/*') ||
        trimmedLine.startsWith('*') ||
        trimmedLine.startsWith('//')
      ) {
        return
      }

      violations.push({
        file: filePath,
        line: index + 1,
        column: match.index! + 1,
        text: line.trim(),
        type: match[1] as any,
      })
    }
  })

  return violations
}

async function main() {
  console.log(colors.blue('Checking task files for console usage...\n'))

  const allViolations: Violation[] = []

  for await (const entry of walk('tasks', {
    includeDirs: false,
    exts: ['.ts'],
  })) {
    const violations = await checkFile(entry.path)
    allViolations.push(...violations)
  }

  if (allViolations.length === 0) {
    console.log(colors.green('✅ No console usage found in task files!'))
    console.log(colors.gray('\nAll tasks are using the output handler correctly.'))
    exit(0)
  }

  // Report violations
  console.log(colors.red(`Found ${allViolations.length} console usage violation(s):\n`))

  // Group by file
  const byFile = new Map<string, Violation[]>()
  for (const violation of allViolations) {
    if (!byFile.has(violation.file)) {
      byFile.set(violation.file, [])
    }
    byFile.get(violation.file)!.push(violation)
  }

  // Display violations
  for (const [file, violations] of byFile) {
    console.log(colors.yellow(`${file}:`))
    for (const v of violations) {
      console.log(
        `  ${colors.gray(`${v.line}:${v.column}`)} ` +
          `console.${colors.red(v.type)} found: ${colors.gray(v.text.substring(0, 60))}...`,
      )
    }
    console.log()
  }

  console.log(colors.cyan('Hint: Tasks should use the output handler from CommandArgs:'))
  console.log(colors.gray('  export function task({ output }: CommandArgs) {'))
  console.log(colors.gray('    output.log("message")  // Instead of console.log'))
  console.log(colors.gray('    output.error("error")  // Instead of console.error'))
  console.log(colors.gray('  }'))

  exit(1)
}

if (import.meta.main) {
  await main()
}
