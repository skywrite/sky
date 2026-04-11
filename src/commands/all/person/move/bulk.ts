import * as path from 'node:path'
import process from 'node:process'
import { rm } from 'node:fs/promises'
import * as readline from 'node:readline'
import colors from 'picocolors'
import { exists, outputFile, readDir, readTextFile, walk } from '#shared/fs/mod.ts'
import { ArgOrFlag, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { generatePersonHierarchyPath } from '../new.ts'
import PersonDocument from '#shared/models/Person/mod.ts'
import { runCommand } from '#lib/sys/mod.ts'

const params = {
  count: ArgOrFlag.number('Number of files to move', { short: 'n' }),
  preview: Flag.boolean('Preview only - show what would be moved without making changes', { short: 'p' }),
  previewOpen: Flag.boolean('Open source files in VSCode without moving', { short: 'o' }),
  remaining: Flag.boolean('Show count of files remaining in people-old/', { short: 'r' }),
  skipOpen: Flag.boolean('Skip opening files in VSCode after copying', { short: 's' }),
}

type Params = InferParams<typeof params>

interface MoveItem {
  source: string
  sourceName: string
  destination: string
  destRelative: string
  content: string
}

type Result = { moved: number; files: string[] }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'person:move:bulk': { params: Params; result: Result }
  }
}

// -----------------------------------------------------------------------------
// Command
// -----------------------------------------------------------------------------

export default class PersonMoveBulkTask extends Command {
  static override description: CommandDescription = {
    name: 'person:move:bulk',
    description: 'Move N people from people-old/ to people/ with batch review in VSCode.',
    usage: [
      'sky person:move:bulk --remaining        # Show count of files left to move',
      'sky person:move:bulk 5 --preview        # Preview what would be moved',
      'sky person:move:bulk 5 --preview-open   # Open source files in VSCode (no move)',
      'sky person:move:bulk 5                  # Move next 5 files, review in VSCode',
      'sky person:move:bulk 5 --skip-open      # Move without opening in VSCode',
    ],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { config, output } = context
    const { count, preview, previewOpen, remaining, skipOpen } = args

    const peopleOldDir = <string>config.DIR_PEOPLE_OLD
    const peopleDir = <string>config.DIR_PEOPLE

    // --remaining flag: just show count and exit
    if (remaining) {
      const totalCount = await countAllFiles(peopleOldDir)
      output.log(`${colors.cyan(String(totalCount))} files remaining in people-old/\n`)
      return CommandResult.success({ moved: 0, files: [] })
    }

    if (!count || count < 1) {
      output.error('Please specify a positive number of files to move')
      return CommandResult.fail('Count is required')
    }

    // 1. Collect first N files
    const files = await collectNextFiles(peopleOldDir, count)

    if (files.length === 0) {
      output.log(colors.yellow('No files found in people-old/\n'))
      return CommandResult.success({ moved: 0, files: [] })
    }

    output.log(`Found ${colors.cyan(String(files.length))} files\n`)

    // 2. Prepare moves (generate destinations)
    const moves = await prepareMoves(files, peopleOldDir, peopleDir)

    // 3. Show preview
    output.log(preview || previewOpen ? colors.blue('Would move:') : colors.blue('Will move:'))
    for (const move of moves) {
      output.log(`  ${colors.dim(move.sourceName)} ${colors.dim('→')} ${colors.white('people/' + move.destRelative)}`)
    }

    // Preview mode - stop here (optionally opening source files)
    if (preview || previewOpen) {
      if (previewOpen) {
        output.log(colors.dim('\nOpening source files in VSCode...'))
        await openInVSCode(files)
      }
      output.log(colors.dim('\n(Preview mode - no changes made)\n'))
      return CommandResult.success({ moved: 0, files: [] })
    }

    // 4. Copy files to new locations
    output.log(colors.dim('\nCopying files...'))
    for (const move of moves) {
      await outputFile(move.destination, move.content)
    }

    // 5. Open all in VSCode (unless --skip-open)
    if (!skipOpen) {
      output.log(colors.dim('Opening files in VSCode...'))
      await openInVSCode(moves.map((m) => m.destination))
    }

    // 6. Wait for confirmation
    output.log(`\n${colors.yellow('Press Enter when done reviewing')} ${colors.dim('(Ctrl+C to abort)')}`)

    try {
      await waitForEnter()
    } catch {
      // Ctrl+C or error - cleanup copies
      output.log(colors.dim('\nAborting - removing copies...'))
      for (const move of moves) {
        try {
          await rm(move.destination)
        } catch {
          // Ignore errors during cleanup
        }
      }
      output.log(colors.yellow('Aborted - copies removed, originals preserved\n'))
      return CommandResult.fail('Aborted by user')
    }

    // 7. Delete originals and clean up empty directories
    output.log(colors.dim('\nRemoving originals...'))
    const removedDirs: string[] = []
    for (const move of moves) {
      await rm(move.source)
      // Clean up empty parent directories
      const cleaned = await cleanupEmptyDirs(path.dirname(move.source), peopleOldDir)
      removedDirs.push(...cleaned)
    }

    // Report removed directories (dedupe since multiple files may be in same dir)
    const uniqueRemovedDirs = [...new Set(removedDirs)]
    if (uniqueRemovedDirs.length > 0) {
      output.log(colors.dim(`\nRemoved ${uniqueRemovedDirs.length} empty directories:`))
      for (const dir of uniqueRemovedDirs) {
        output.log(colors.dim(`  ${path.relative(peopleOldDir, dir)}`))
      }
    }

    const remainingCount = await countAllFiles(peopleOldDir)
    output.log(
      `\n${colors.green('✓')} Moved ${colors.cyan(String(moves.length))} files ${colors.dim(
        `(${remainingCount} remaining)`,
      )}\n`,
    )
    return CommandResult.success({
      moved: moves.length,
      files: moves.map((m) => m.destination),
    })
  }
}

// -----------------------------------------------------------------------------
// Helper Functions
// -----------------------------------------------------------------------------

/**
 * Count all .md files in directory
 */
async function countAllFiles(dir: string): Promise<number> {
  let count = 0
  for await (const _entry of walk(dir, {
    exts: ['.md'],
    includeDirs: false,
  })) {
    count++
  }
  return count
}

/**
 * Remove empty directories up to (but not including) the root directory.
 * Returns list of directories that were removed.
 */
async function cleanupEmptyDirs(dir: string, rootDir: string): Promise<string[]> {
  const removed: string[] = []
  let current = dir

  while (current !== rootDir && current.startsWith(rootDir)) {
    // Check if directory is empty
    const entries: string[] = []
    for await (const entry of readDir(current)) {
      entries.push(entry.name)
      if (entries.length > 0) break // Just need to know if non-empty
    }

    if (entries.length === 0) {
      await rm(current, { recursive: true })
      removed.push(current)
      current = path.dirname(current)
    } else {
      break // Directory not empty, stop
    }
  }

  return removed
}

/**
 * Walk directory and collect first N .md files (filesystem order, depth-first)
 */
async function collectNextFiles(dir: string, count: number): Promise<string[]> {
  const files: string[] = []

  for await (const entry of walk(dir, {
    exts: ['.md'],
    includeDirs: false,
  })) {
    files.push(entry.path)
    if (files.length >= count) {
      break
    }
  }

  return files
}

/**
 * Parse each file and generate destination paths.
 * Prefers keeping the original filename if no collision exists.
 */
async function prepareMoves(files: string[], peopleOldDir: string, peopleDir: string): Promise<MoveItem[]> {
  const moves: MoveItem[] = []

  for (const source of files) {
    const fileContent = await readTextFile(source)
    const personData = PersonDocument.fromMarkdown(fileContent)

    // Generate the new directory path based on person's name
    const personName = personData.name || path.basename(source, '.md')
    const effectiveYear = personData.met?.year
    const hierarchyPath = generatePersonHierarchyPath(personName, effectiveYear)
    const destDir = path.join(peopleDir, hierarchyPath)

    // Prefer keeping the original filename if no collision
    const originalFilename = path.basename(source)
    const slugFilename = `${personData.slugPreserveCase}.md`

    let destFile: string
    const originalDest = path.join(destDir, originalFilename)
    const slugDest = path.join(destDir, slugFilename)

    if (!(await exists(originalDest))) {
      // Original filename works - use it
      destFile = originalDest
    } else if (originalFilename !== slugFilename && !(await exists(slugDest))) {
      // Original exists, but slug-based name is available
      destFile = slugDest
    } else {
      // Both exist - add counter to slug-based name
      destFile = slugDest
      let fileCounter = 2
      while (await exists(destFile)) {
        destFile = path.join(destDir, `${personData.slugPreserveCase}-${fileCounter}.md`)
        fileCounter++
      }
    }

    // Prepare updated content
    const updatedPerson = personData.ensureUpdated()
    const markdown = updatedPerson.toMarkdown()

    moves.push({
      source,
      sourceName: path.relative(peopleOldDir, source),
      destination: destFile,
      destRelative: path.relative(peopleDir, destFile),
      content: markdown,
    })
  }

  return moves
}

/**
 * Open files in VSCode using the code CLI
 */
async function openInVSCode(paths: string[]): Promise<void> {
  if (paths.length === 0) return
  await runCommand('code', paths)
}

/**
 * Wait for user to press Enter. Throws on Ctrl+C or close.
 */
function waitForEnter(): Promise<void> {
  return new Promise((resolve, reject) => {
    let resolved = false

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    rl.on('SIGINT', () => {
      if (!resolved) {
        resolved = true
        rl.close()
        reject(new Error('Aborted'))
      }
    })

    rl.question('', () => {
      if (!resolved) {
        resolved = true
        rl.close()
        resolve()
      }
    })
  })
}
