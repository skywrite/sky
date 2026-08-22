import { mkdir, readdir, rename, rmdir } from 'node:fs/promises'
import * as path from 'node:path'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { exists, walk } from '#shared/fs/mod.ts'
import { configured } from '#shared/nbfs/layout/mod.ts'
import { toTimeRef } from '#shared/nbfs/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

const params = {
  execute: Flag.bool('Actually perform the migration (dry-run by default)', {
    default: false,
  }),
}

type Params = InferParams<typeof params>
type Result = {
  moved: number
  weekFilesMoved: number
  skipped: number
  leftovers: number
  errors: number
  dryRun: boolean
}

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
    description: 'Re-file the time tree into the configured layout (nbfs.layout)',
    descriptionLong: [
      'Moves every day directory to its configured-layout path, parsing any',
      'layout the notebook has ever written (v1.1 week ranges including',
      'year-boundary artifacts, legacy DD/xDD day dirs, both v2 variants).',
      'Dry-run by default — pass --execute to actually move files.',
      'Also moves week-level files (_tracking/, week.md, summary.md) to the new week directories.',
      'Cleans up empty directories and reports leftover documents no layout claims.',
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
    const weekMoves = new Map<string, string>() // old weekDir → configured weekDir
    const errors: string[] = []
    const allFiles: string[] = []
    let skipped = 0

    for await (const entry of walk(timeDir)) {
      if (entry.isFile) allFiles.push(entry.path)
      if (!entry.isFile || entry.name !== 'day.md') continue

      const oldDayDir = path.dirname(entry.path)

      // toTimeRef reads every layout the notebook has ever written — v1.1
      // week ranges (year-boundary artifacts arbitrated by week range),
      // legacy DD/xDD day dirs, and both v2 variants.
      let date: PlainDate
      try {
        date = new PlainDate(toTimeRef(entry.path).slice(0, 10))
      } catch {
        errors.push(`Cannot parse path: ${entry.path}`)
        continue
      }

      const newDayDir = path.join(timeDir, configured.dayDir(date))

      // Already at correct path
      if (oldDayDir === newDayDir) {
        skipped++
        continue
      }

      moves.push({ oldDir: oldDayDir, newDir: newDayDir, date: date.ymd })

      // Track week dir mapping for week-level file migration
      const oldWeekDir = path.dirname(oldDayDir)
      const newWeekDir = path.join(timeDir, configured.weekDir(date))
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

    // ── Leftover documents no layout claims ────────────────────────────
    // Markdown files that will sit outside the configured layout even after
    // the moves: not inside a moving day or week directory, not a time-root
    // file (reminders.md and friends live there by design), and not
    // classifiable by the configured layout (e.g. stray month-level notes).
    // Computed from the plan, so it reports identically in dry-run, execute,
    // and no-op reruns.

    const movedDayDirs = new Set(moves.map((m) => m.oldDir))
    const movedWeekDirs = new Set(weekMoves.keys())
    const claimedByMove = (f: string): boolean => {
      for (let dir = path.dirname(f); dir.startsWith(timeDir + path.sep); dir = path.dirname(dir)) {
        if (movedDayDirs.has(dir) || movedWeekDirs.has(dir)) return true
      }
      return false
    }
    const leftovers = allFiles.filter(
      (f) =>
        f.endsWith('.md') && path.dirname(f) !== timeDir && !claimedByMove(f) && configured.parseTimePath(f) === null,
    )
    if (leftovers.length > 0) {
      output.log(`\n${leftovers.length} leftover documents no layout claims — file these manually:`)
      for (const f of leftovers) output.log(`  ⚠ ${this.rel(f, timeDir)}`)
    }

    if (moves.length === 0) {
      output.log('\nNothing to migrate.')
      return CommandResult.success({
        moved: 0,
        weekFilesMoved: 0,
        skipped,
        leftovers: leftovers.length,
        errors: errors.length,
        dryRun,
      })
    }

    // ── Phase 2: Deduplicate and check for conflicts ───────────────────

    // Detect duplicate sources mapping to the same destination
    // (two historical paths encoding the same date)
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

    // Check for conflicts with existing destination directories on disk
    const conflicts: DayMove[] = []
    for (const move of moves) {
      if (await exists(move.newDir)) {
        conflicts.push(move)
      }
    }

    if (conflicts.length > 0) {
      output.log(`\n${conflicts.length} conflicts — destination already exists:`)
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
        const weekLevelEntries = entries.filter((e) => !isDayDirEntry(e))
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
    output.log(`Already at the configured layout (skipped): ${skipped}`)
    output.log(`Leftover documents: ${leftovers.length}`)
    if (errors.length > 0) output.log(`Errors: ${errors.length}`)

    if (dryRun && moved > 0) {
      output.log(`\nRun with --execute to perform the migration.`)
    }

    return errors.length > 0
      ? CommandResult.fail(`Migration completed with ${errors.length} errors`)
      : CommandResult.success({
          moved,
          weekFilesMoved,
          skipped,
          leftovers: leftovers.length,
          errors: errors.length,
          dryRun,
        })
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

/** Day-dir entry in any layout the notebook has written: MM-DD, legacy DD / xDD. */
function isDayDirEntry(name: string): boolean {
  return /^x?\d{1,2}$/.test(name) || /^\d{2}-\d{2}$/.test(name)
}
