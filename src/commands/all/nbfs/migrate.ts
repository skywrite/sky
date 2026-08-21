import { mkdir, readdir, rename, rmdir } from 'node:fs/promises'
import * as path from 'node:path'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { exists, walk } from '#shared/fs/mod.ts'
import { v1_1, v2 } from '#shared/nbfs/layout/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

const params = {
  execute: Flag.bool('Actually perform the migration (dry-run by default)', {
    default: false,
  }),
}

type Params = InferParams<typeof params>
type Result = { moved: number; weekFilesMoved: number; skipped: number; errors: number; dryRun: boolean }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'nbfs:migrate': { params: Params; result: Result }
  }
}

interface DayMove {
  oldDir: string
  newDir: string
  date: string
}

export default class NbfsMigrateTask extends Command {
  static override description: CommandDescription = {
    name: 'nbfs:migrate',
    description: 'Migrate day files from NBFS v1 to v2 directory structure',
    descriptionLong: [
      'Moves day directories from v1.1 paths (YYYY/MM/DD-DD/MM-DD/) to v2 paths (YYYY/W##/MM-DD/).',
      'Dry-run by default — pass --execute to actually move files.',
      'Handles cross-month x-prefix days.',
      'Also moves week-level files (_tracking/, summary.md) to new week directories.',
      'Cleans up empty directories after migration.',
    ],
    usage: [
      'sky nbfs:migrate              # Dry-run: show what would move',
      'sky nbfs:migrate --execute    # Actually perform the migration',
    ],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output, config } = context
    const dryRun = !args.execute
    const timeDir = <string>config.DIR_TIME

    if (dryRun) {
      output.log('DRY RUN — no files will be moved. Pass --execute to migrate.\n')
    } else {
      output.log('EXECUTING MIGRATION — files will be moved.\n')
    }

    // ── Phase 1: Discover all day.md files and plan moves ──────────────

    const moves: DayMove[] = []
    const weekMoves = new Map<string, string>() // v1 weekDir → v2 weekDir
    const errors: string[] = []
    let skipped = 0

    for await (const entry of walk(timeDir)) {
      if (!entry.isFile || entry.name !== 'day.md') continue

      const oldDayDir = path.dirname(entry.path)

      // Try v1 parse, then legacy formats, then v2 (already migrated)
      let date
      try {
        date = v1_1.parseDateFromDayPath(entry.path)
      } catch {
        // Try legacy formats (early 2020: underscore week dirs, no week dir)
        const legacyDate = parseLegacyPath(entry.path)
        if (legacyDate) {
          date = legacyDate
        } else {
          // Maybe already in v2 format?
          try {
            v2.parseDateFromDayPath(entry.path)
            skipped++
            continue
          } catch {
            errors.push(`Cannot parse path: ${entry.path}`)
            continue
          }
        }
      }

      const newDayDir = path.join(timeDir, v2.dayDir(date))

      // Already at correct path
      if (oldDayDir === newDayDir) {
        skipped++
        continue
      }

      moves.push({ oldDir: oldDayDir, newDir: newDayDir, date: date.ymd })

      // Track week dir mapping for week-level file migration
      const oldWeekDir = path.dirname(oldDayDir)
      const newWeekDir = path.join(timeDir, v2.weekDir(date))
      if (!weekMoves.has(oldWeekDir)) {
        weekMoves.set(oldWeekDir, newWeekDir)
      }
    }

    // Sort by date for deterministic output
    moves.sort((a, b) => a.date.localeCompare(b.date))

    output.log(`Found ${moves.length} day directories to move, ${skipped} already migrated`)
    if (errors.length > 0) {
      output.log(`${errors.length} paths could not be parsed:`)
      for (const err of errors) output.log(`  ⚠ ${err}`)
    }

    if (moves.length === 0) {
      output.log('\nNothing to migrate.')
      return CommandResult.success({ moved: 0, weekFilesMoved: 0, skipped, errors: errors.length, dryRun })
    }

    // ── Phase 2: Deduplicate and check for conflicts ───────────────────

    // Detect duplicate sources mapping to the same v2 destination
    // (e.g., legacy underscore path and v1 path for the same date)
    const destToMoves = new Map<string, DayMove[]>()
    for (const move of moves) {
      const existing = destToMoves.get(move.newDir)
      if (existing) {
        existing.push(move)
      } else {
        destToMoves.set(move.newDir, [move])
      }
    }

    const duplicates = [...destToMoves.entries()].filter(([_, m]) => m.length > 1)
    if (duplicates.length > 0) {
      output.log(`\n${duplicates.length} dates have multiple source paths:`)
      for (const [dest, dupes] of duplicates) {
        output.log(`  ${dupes[0].date}: ${this.rel(dest, timeDir)}`)
        for (const d of dupes) {
          output.log(`    ← ${this.rel(d.oldDir, timeDir)}`)
        }
      }
      return CommandResult.fail(
        `${duplicates.length} dates have multiple source paths. Resolve duplicates before migrating.`,
      )
    }

    // Check for conflicts with existing v2 directories on disk
    const conflicts: DayMove[] = []
    for (const move of moves) {
      if (await exists(move.newDir)) {
        conflicts.push(move)
      }
    }

    if (conflicts.length > 0) {
      output.log(`\n${conflicts.length} conflicts — v2 destination already exists:`)
      for (const c of conflicts) {
        output.log(`  ✗ ${c.date}: ${this.rel(c.newDir, timeDir)} already exists`)
      }
      return CommandResult.fail(
        `${conflicts.length} destination directories already exist. Resolve conflicts before migrating.`,
      )
    }

    // ── Phase 3: Execute day directory moves ───────────────────────────

    output.log(`\n${dryRun ? 'Would move' : 'Moving'} ${moves.length} day directories:\n`)

    let moved = 0
    for (const move of moves) {
      const oldRel = this.rel(move.oldDir, timeDir)
      const newRel = this.rel(move.newDir, timeDir)
      output.log(`  ${move.date}: ${oldRel} → ${newRel}`)

      if (!dryRun) {
        try {
          await mkdir(path.dirname(move.newDir), { recursive: true })
          await rename(move.oldDir, move.newDir)
          moved++
        } catch (err) {
          errors.push(`Failed to move ${oldRel}: ${(err as Error).message}`)
          output.log(`    ✗ FAILED: ${(err as Error).message}`)
        }
      } else {
        moved++
      }
    }

    // ── Phase 4: Move week-level files ─────────────────────────────────

    let weekFilesMoved = 0
    const weekDirsWithContent: Array<{ oldWeekDir: string; newWeekDir: string; entries: string[] }> = []

    for (const [oldWeekDir, newWeekDir] of weekMoves) {
      if (!dryRun && !(await exists(oldWeekDir))) continue

      try {
        const entries = await readdir(oldWeekDir)
        // Filter out entries that are now-empty day directories (will be cleaned up)
        // Keep anything that's not a pure number or x-prefixed number (day dirs)
        const weekLevelEntries = entries.filter((e) => !isV1StructuralDir(e))
        if (weekLevelEntries.length > 0) {
          weekDirsWithContent.push({ oldWeekDir, newWeekDir, entries: weekLevelEntries })
        }
      } catch {
        // Directory may not exist in dry-run, or was already cleaned up
      }
    }

    if (weekDirsWithContent.length > 0) {
      output.log(
        `\n${dryRun ? 'Would move' : 'Moving'} week-level files from ${weekDirsWithContent.length} week directories:\n`,
      )

      for (const { oldWeekDir, newWeekDir, entries } of weekDirsWithContent) {
        const oldRel = this.rel(oldWeekDir, timeDir)
        const newRel = this.rel(newWeekDir, timeDir)
        output.log(`  ${oldRel} → ${newRel}: ${entries.join(', ')}`)

        if (!dryRun) {
          try {
            await mkdir(newWeekDir, { recursive: true })
            for (const entry of entries) {
              const src = path.join(oldWeekDir, entry)
              const dst = path.join(newWeekDir, entry)
              if (await exists(dst)) {
                output.log(`    ⚠ Skipping ${entry} — already exists at destination`)
                continue
              }
              await rename(src, dst)
              weekFilesMoved++
            }
          } catch (err) {
            errors.push(`Failed to move week files from ${oldRel}: ${(err as Error).message}`)
            output.log(`    ✗ FAILED: ${(err as Error).message}`)
          }
        } else {
          weekFilesMoved += entries.length
        }
      }
    }

    // ── Phase 5: Clean up empty directories ────────────────────────────

    if (!dryRun) {
      const removed = await this.cleanupEmptyDirs(timeDir)
      if (removed > 0) {
        output.log(`\nCleaned up ${removed} empty directories`)
      }
    }

    // ── Summary ────────────────────────────────────────────────────────

    output.log(`\n--- Summary ---`)
    output.log(`Day directories ${dryRun ? 'to move' : 'moved'}: ${moved}`)
    output.log(`Week-level files ${dryRun ? 'to move' : 'moved'}: ${weekFilesMoved}`)
    output.log(`Already migrated (skipped): ${skipped}`)
    if (errors.length > 0) output.log(`Errors: ${errors.length}`)

    if (dryRun && moved > 0) {
      output.log(`\nRun with --execute to perform the migration.`)
    }

    return errors.length > 0
      ? CommandResult.fail(`Migration completed with ${errors.length} errors`)
      : CommandResult.success({ moved, weekFilesMoved, skipped, errors: errors.length, dryRun })
  }

  /** Remove empty directories bottom-up */
  private async cleanupEmptyDirs(root: string): Promise<number> {
    let removed = 0
    // Collect all directories, then process deepest first
    const dirs: string[] = []
    for await (const entry of walk(root, { includeDirs: true })) {
      if (entry.isDirectory && entry.path !== root) {
        dirs.push(entry.path)
      }
    }

    // Sort by depth (deepest first) so children are removed before parents
    dirs.sort((a, b) => b.split(path.sep).length - a.split(path.sep).length)

    for (const dir of dirs) {
      try {
        const entries = await readdir(dir)
        if (entries.length === 0) {
          await rmdir(dir)
          removed++
        }
      } catch {
        // Directory may have been removed as part of a parent cleanup
      }
    }

    return removed
  }

  /** Get a path relative to the time directory for display */
  private rel(fullPath: string, timeDir: string): string {
    return path.relative(timeDir, fullPath)
  }
}

/** Check if a directory name looks like a v1 day dir or week range dir */
function isV1StructuralDir(name: string): boolean {
  // Day dirs: "15", "x02", "7"
  if (/^x?\d{1,2}$/.test(name)) return true
  // Week range dirs: "27-02", "09-15"
  if (/^\d{2}-\d{2}$/.test(name)) return true
  // Underscore week range dirs: "12_07-12_13"
  if (/^\d{2}_\d{2}-\d{2}_\d{2}$/.test(name)) return true
  return false
}

/**
 * Parse dates from legacy path formats used in early 2020:
 *
 * 1. Underscore week dirs: time/2020/12_07-12_13/07/day.md
 *    Pattern: YYYY/MM_DD-MM_DD/DD/day.md
 *
 * 2. No week dir: time/2020/01/17/day.md
 *    Pattern: YYYY/MM/DD/day.md (day dir directly under month)
 */
function parseLegacyPath(filePath: string): PlainDate | undefined {
  const parts = filePath.split(path.sep)
  const timeIndex = parts.indexOf('time')
  if (timeIndex === -1) return undefined

  const yearStr = parts[timeIndex + 1]
  if (!yearStr) return undefined
  const year = parseInt(yearStr, 10)
  if (isNaN(year)) return undefined

  const segment2 = parts[timeIndex + 2] // either "MM_DD-MM_DD" or "MM"
  const segment3 = parts[timeIndex + 3] // either "DD" (day dir) or "day.md" or "DD" (day dir under month)
  if (!segment2 || !segment3) return undefined

  // Format 1: Underscore week dirs — 12_07-12_13
  const underscoreMatch = segment2.match(/^(\d{2})_\d{2}-(\d{2})_\d{2}$/)
  if (underscoreMatch) {
    const startMonth = parseInt(underscoreMatch[1], 10)
    const endMonth = parseInt(underscoreMatch[2], 10)
    const day = parseInt(segment3, 10)
    if (isNaN(day)) return undefined

    // If the day dir's day number > 20 and endMonth > startMonth,
    // the day is in the start month; otherwise it's in the end month.
    // Simple heuristic: if day <= days that could be at end of startMonth, use startMonth.
    // Actually, the week dir format tells us the range spans startMonth to endMonth.
    // Days from the start month will have higher numbers (e.g., 28, 29, 30, 31).
    // Days from the end month will have lower numbers (e.g., 01, 02, 03).
    // Use the same logic as v1's x-prefix: if startMonth !== endMonth and day is small,
    // it's in endMonth.
    let month = startMonth
    if (startMonth !== endMonth && day < 8) {
      month = endMonth
    }

    return new PlainDate(year, month, day)
  }

  // Format 2: No week dir — time/2020/01/17/day.md
  const month = parseInt(segment2, 10)
  if (isNaN(month) || month < 1 || month > 12) return undefined

  // segment3 should be the day number (the day directory)
  const day = parseInt(segment3, 10)
  if (isNaN(day) || day < 1 || day > 31) return undefined

  // Verify segment4 is day.md (this is a day dir, not a week dir)
  const segment4 = parts[timeIndex + 4]
  if (segment4 === 'day.md') {
    return new PlainDate(year, month, day)
  }

  return undefined
}
