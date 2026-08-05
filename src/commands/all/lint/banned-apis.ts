#!/usr/bin/env -S deno run --allow-read

/**
 * Custom linter to check for banned Deno APIs
 *
 * These APIs should be abstracted through shared modules for
 * cross-runtime compatibility (Deno, Node, Bun).
 */

import colors from 'picocolors'
import { readTextFile, walk } from '#shared/fs/mod.ts'
import { exit } from '#shared/sys/mod.ts'

interface Violation {
  file: string
  line: number
  text: string
  api: string
}

const BANNED_APIS = [
  { pattern: /Deno\.env/, name: 'Deno.env', suggestion: "import { env } from '#shared/sys/mod.ts'" },
  { pattern: /Deno\.exit/, name: 'Deno.exit', suggestion: "import { exit } from '#shared/sys/mod.ts'" },
  {
    pattern: /Deno\.readTextFile/,
    name: 'Deno.readTextFile',
    suggestion: "import { readTextFile } from '#shared/fs/mod.ts'",
  },
  {
    pattern: /Deno\.writeTextFile/,
    name: 'Deno.writeTextFile',
    suggestion: "import { writeTextFile } from '#shared/fs/mod.ts'",
  },
  { pattern: /Deno\.Command/, name: 'Deno.Command', suggestion: "import { runCommand } from '#lib/sys/mod.ts'" },
  { pattern: /Deno\.stat/, name: 'Deno.stat', suggestion: "import { stat } from 'node:fs/promises'" },
  { pattern: /Deno\.lstat/, name: 'Deno.lstat', suggestion: "import { lstat } from 'node:fs/promises'" },
  {
    pattern: /Deno\.open/,
    name: 'Deno.open',
    suggestion: "import { createWriteStream } from 'node:fs' or import { open } from 'node:fs/promises'",
  },
  { pattern: /Deno\.readFile/, name: 'Deno.readFile', suggestion: "import { readFile } from 'node:fs/promises'" },
  { pattern: /Deno\.writeFile/, name: 'Deno.writeFile', suggestion: "import { writeFile } from 'node:fs/promises'" },
  { pattern: /Deno\.cwd/, name: 'Deno.cwd', suggestion: "import process from 'node:process'; process.cwd()" },
  { pattern: /Deno\.args/, name: 'Deno.args', suggestion: "import process from 'node:process'; process.argv.slice(2)" },
  { pattern: /Deno\.build/, name: 'Deno.build', suggestion: "import process from 'node:process'; process.platform" },
  { pattern: /Deno\.test/, name: 'Deno.test', suggestion: "import { test } from '#test'" },
  {
    pattern: /Deno\.stdin/,
    name: 'Deno.stdin',
    suggestion: "import { isTerminal, setRaw, readStdin } from '#shared/sys/mod.ts' or use 'node:readline'",
  },
  {
    pattern: /Deno\.stdout/,
    name: 'Deno.stdout',
    suggestion: "import { writeStdout } from '#shared/sys/mod.ts' or process.stdout.write()",
  },
  {
    pattern: /Deno\.consoleSize/,
    name: 'Deno.consoleSize',
    suggestion: "import { consoleSize } from '#shared/sys/mod.ts'",
  },
  {
    pattern: /Deno\.watchFs/,
    name: 'Deno.watchFs',
    suggestion: "import { watchFs } from '#shared/fs/mod.ts'",
  },
  {
    pattern: /Deno\.FsEvent/,
    name: 'Deno.FsEvent',
    suggestion: "import { type FsEvent, type FsEventKind } from '#shared/fs/mod.ts'",
  },
  {
    pattern: /Deno\.serve/,
    name: 'Deno.serve',
    suggestion: "import { serve } from '@hono/node-server'",
  },
  {
    pattern: /Deno\.HttpServer/,
    name: 'Deno.HttpServer',
    suggestion: "import type { ServerType } from '@hono/node-server'",
  },
  // Deno std library imports - use cross-runtime alternatives
  {
    pattern: /from ['"]std\/path['"]/,
    name: 'std/path',
    suggestion: "import * as path from 'node:path'",
  },
  {
    pattern: /from ['"]std\/fmt\/colors['"]/,
    name: 'std/fmt/colors',
    suggestion: "import colors from 'picocolors'",
  },
  {
    pattern: /from ['"]std\/flags['"]/,
    name: 'std/flags',
    suggestion: "import mri from 'mri'; import type { Args } from '#commands/lib/commands.d.ts'",
  },
  {
    pattern: /from ['"]std\/encoding\/jsonc['"]/,
    name: 'std/encoding/jsonc',
    suggestion: "import { parse } from 'jsonc-parser'",
  },
  {
    pattern: /from ['"]std\/async['"]/,
    name: 'std/async',
    suggestion: "import { setTimeout as delay } from 'node:timers/promises'",
  },
  // Catch-all for any other std/ imports
  {
    pattern: /from ['"]std\//,
    name: 'std/*',
    suggestion: 'All std/ imports are banned. Use cross-runtime alternatives (node: built-ins or npm packages).',
  },
]

async function checkFile(filePath: string): Promise<Violation[]> {
  const violations: Violation[] = []
  const content = await readTextFile(filePath)
  const lines = content.split('\n')

  // Skip files that define the abstractions or have special requirements
  if (
    filePath.includes('_shared-ts/sys/env.ts') ||
    filePath.includes('_shared-ts/sys/exit.ts') ||
    filePath.includes('_shared-ts/sys/terminal.ts') ||
    filePath.includes('_shared-ts/fs/readTextFile.ts') ||
    filePath.includes('_shared-ts/fs/writeTextFile.ts') ||
    filePath.includes('_shared-ts/fs/watch.ts') ||
    filePath.includes('lib/sys/command.ts') ||
    filePath.includes('lint/banned-apis.ts')
  ) {
    return violations
  }

  lines.forEach((line, index) => {
    // Skip comments
    const trimmed = line.trim()
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) {
      return
    }

    for (const banned of BANNED_APIS) {
      if (banned.pattern.test(line)) {
        violations.push({
          file: filePath,
          line: index + 1,
          text: line.trim(),
          api: banned.name,
        })
      }
    }
  })

  return violations
}

async function main() {
  console.log(colors.blue('Checking for banned Deno APIs...\n'))

  const allViolations: Violation[] = []

  // Scan all TypeScript files
  for await (const entry of walk('.', {
    includeDirs: false,
    exts: ['.ts'],
    skip: [/node_modules/, /\.git/, /deps\//, /extensions\//],
  })) {
    const violations = await checkFile(entry.path)
    allViolations.push(...violations)
  }

  if (allViolations.length === 0) {
    console.log(colors.green('✅ No banned API usage found!'))
    exit(0)
  }

  console.log(colors.red(`Found ${allViolations.length} banned API usage(s):\n`))

  // Group by file
  const byFile = new Map<string, Violation[]>()
  for (const violation of allViolations) {
    if (!byFile.has(violation.file)) {
      byFile.set(violation.file, [])
    }
    byFile.get(violation.file)!.push(violation)
  }

  for (const [file, violations] of byFile) {
    console.log(colors.yellow(`${file}:`))
    for (const v of violations) {
      console.log(`  ${colors.gray(`${v.line}`)} ${colors.red(v.api)}: ${colors.gray(v.text.substring(0, 70))}`)
    }
    console.log()
  }

  console.log(colors.cyan('Banned APIs and their replacements:'))
  for (const banned of BANNED_APIS) {
    console.log(colors.gray(`  ${banned.name} → ${banned.suggestion}`))
  }

  exit(1)
}

if (import.meta.main) {
  await main()
}
