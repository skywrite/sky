import { randomUUID } from 'node:crypto'
import { mkdir, readdir, rename, rmdir, unlink, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { exists, outputFile, readTextFile } from '#shared/fs/mod.ts'
import TrackingDocument from '#shared/models/Tracking/mod.ts'
import { parseCsvLine } from '#universal/encoding/csv/mod.ts'
import { columnName, readTrackingCsv, weeklyMonday, writeTrackingCsv, type TrackingCsv } from './csv.ts'
import { formatHeader } from './records.ts'

interface Change {
  path: string
  before: string | null
  after: string | null
}

export interface TrackingRepair {
  /** Notebook-relative CSV path and one exact physical line to replace. */
  path: string
  before: string
  after: string
}

export interface TrackingMigration {
  root: string
  changes: Change[]
  weeklyFiles: number
  yearlyFiles: number
  definitions: number
  sourceRows: number
  addedRows: number
  matchedRows: number
  warnings: string[]
  leftovers: string[]
  repairs: TrackingRepair[]
}

/** Unlike the general walk helper, unreadable directories must fail a migration. */
async function files(root: string): Promise<string[]> {
  if (!(await exists(root))) return []
  const result: string[] = []
  for (const entry of (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(root, entry.name)
    if (entry.isDirectory()) result.push(...(await files(file)))
    else if (entry.isFile()) result.push(file)
    else throw new Error(`Unsupported filesystem entry: ${file}`)
  }
  return result
}

function safeName(name: string): void {
  if (!name || name === '.' || name === '..' || /[/\\]/.test(name)) throw new Error(`Invalid tracking slug: ${name}`)
}

function align(table: TrackingCsv, header: string[], aliases: Map<string, string>): string[][] {
  const positions = table.header.map((h) => header.indexOf(aliases.get(h) ?? h))
  if (new Set(positions).size !== positions.length) throw new Error('Columns would collapse during migration')
  return table.rows.map((row) => {
    const aligned = header.map(() => '')
    row.forEach((value, i) => {
      aligned[positions[i]] = value
    })
    return aligned
  })
}

export async function planTrackingMigration(root: string, repairs: TrackingRepair[] = []): Promise<TrackingMigration> {
  const plan: TrackingMigration = {
    root,
    changes: [],
    weeklyFiles: 0,
    yearlyFiles: 0,
    definitions: 0,
    sourceRows: 0,
    addedRows: 0,
    matchedRows: 0,
    warnings: [],
    leftovers: [],
    repairs,
  }
  const definitions = new Map<string, TrackingDocument>()
  for (const file of await files(path.join(root, 'tracking'))) {
    if (!file.endsWith('.md')) continue
    const before = await readTextFile(file)
    const def = TrackingDocument.fromMarkdown(before)
    if (def.yamlError || !def.name) throw new Error(`Invalid tracking definition: ${file}`)
    safeName(def.name)
    if (definitions.has(def.name)) throw new Error(`Duplicate tracking definition: ${def.name}`)
    definitions.set(def.name, def)
    if (def.yaml['storage'] !== 'yearly') {
      const after = def.updateYaml({ storage: 'yearly' }).toMarkdown()
      plan.changes.push({ path: file, before, after })
      plan.definitions++
    }
  }

  const groups = new Map<string, { name: string; tables: TrackingCsv[] }>()
  const categories = new Map<string, string>()
  const timeDir = path.join(root, 'time')
  const appliedRepairs = new Set<TrackingRepair>()
  for (const file of await files(timeDir)) {
    const rel = path.relative(timeDir, file)
    const parts = rel.split(path.sep)
    const trackingIndex = parts.indexOf('_tracking')
    if (trackingIndex < 0) continue
    if (!file.endsWith('.csv')) {
      plan.leftovers.push(file)
      continue
    }
    const name = path.basename(file, '.csv')
    safeName(name)
    const category = parts.slice(trackingIndex + 1, -1).join('/')
    const previous = categories.get(name)
    if (previous !== undefined && previous !== category)
      throw new Error(`Tracking slug appears in multiple categories: ${name}`)
    categories.set(name, category)
    const before = await readTextFile(file)
    let input = before
    for (const repair of repairs.filter((r) => r.path === path.relative(root, file))) {
      const lines = input.split(/\r?\n/)
      if (
        !repair.before ||
        /[\r\n]/.test(repair.before + repair.after) ||
        lines.filter((l) => l === repair.before).length !== 1
      ) {
        throw new Error(`Repair must match exactly one line: ${file}`)
      }
      input = lines.map((line) => (line === repair.before ? repair.after : line)).join('\n')
      appliedRepairs.add(repair)
      plan.warnings.push(`${file}: applied an explicit CSV repair (original backed up)`)
    }
    let table: TrackingCsv
    try {
      table = readTrackingCsv(input, weeklyMonday(rel))
    } catch (error) {
      throw new Error(`${file}: ${String(error)}`)
    }
    plan.warnings.push(...table.warnings.map((w) => `${file}: ${w}`))
    plan.sourceRows += table.rows.length
    plan.weeklyFiles++
    plan.changes.push({ path: file, before, after: null })
    for (const year of new Set(table.rows.map((r) => r[0].slice(0, 4)))) {
      const target = path.join(root, 'data', 'tracking', year, `${name}.csv`)
      const group = groups.get(target) ?? { name, tables: [] }
      group.tables.push({ ...table, rows: table.rows.filter((r) => r[0].startsWith(`${year}-`)) })
      groups.set(target, group)
    }
  }

  if (appliedRepairs.size !== repairs.length) throw new Error('Some CSV repairs did not match a source file')

  for (const [target, group] of groups) {
    const before = (await exists(target)) ? await readTextFile(target) : null
    const existing = before === null ? { header: [], rows: [], warnings: [] } : readTrackingCsv(before)
    const year = path.basename(path.dirname(target))
    if (existing.rows.some((r) => !r[0].startsWith(`${year}-`)))
      throw new Error(`Date outside annual file's year: ${target}`)
    const def = definitions.get(group.name)
    const header = def
      ? parseCsvLine(formatHeader(def.updateYaml({ storage: 'yearly' }) as TrackingDocument))
      : ['date']
    const aliases = new Map<string, string>()
    for (const h of header) aliases.set(columnName(h), h)
    for (const table of [existing, ...group.tables]) {
      for (const h of table.header) {
        const canonical = aliases.get(h) ?? h
        if (!header.includes(canonical)) header.push(canonical)
      }
    }
    // Existing annual rows cover the same number of identical legacy rows.
    // Repeated observations within the legacy data remain repeated observations.
    const rows = align(existing, header, aliases)
    const available = new Map<string, number>()
    for (const row of rows) {
      const key = JSON.stringify(row)
      available.set(key, (available.get(key) ?? 0) + 1)
    }
    for (const table of group.tables) {
      for (const row of align(table, header, aliases)) {
        const key = JSON.stringify(row)
        const count = available.get(key) ?? 0
        if (count) {
          available.set(key, count - 1)
          plan.matchedRows++
          continue
        }
        rows.push(row)
        plan.addedRows++
      }
    }
    rows.sort((a, b) => a[0].localeCompare(b[0]))
    const after = writeTrackingCsv(header, rows)
    // Even an identical target must participate in snapshot checks and output
    // verification before the legacy rows it covers can be retired.
    plan.changes.push({ path: target, before, after })
    plan.yearlyFiles++
  }
  return plan
}

async function checkUnchanged(change: Change): Promise<void> {
  const actual = (await exists(change.path)) ? await readTextFile(change.path) : null
  if (actual !== change.before) throw new Error(`File changed since planning: ${change.path}`)
}

/** Back up everything first; retire sources only after every output verifies. */
export async function executeTrackingMigration(plan: TrackingMigration): Promise<string | undefined> {
  if (!plan.changes.length) return undefined
  for (const change of plan.changes) await checkUnchanged(change)
  const backup = path.join(plan.root, 'data', '.tracking-migration-backups', randomUUID())
  await mkdir(backup, { recursive: true })
  for (const change of plan.changes) {
    if (change.before !== null) {
      const copy = path.join(backup, path.relative(plan.root, change.path))
      await outputFile(copy, change.before)
      if ((await readTextFile(copy)) !== change.before) throw new Error(`Backup verification failed: ${copy}`)
    }
  }
  await outputFile(
    path.join(backup, 'manifest.json'),
    JSON.stringify(
      {
        changes: plan.changes.map((c) => ({
          path: path.relative(plan.root, c.path),
          existed: c.before !== null,
          removed: c.after === null,
        })),
        sourceRows: plan.sourceRows,
        addedRows: plan.addedRows,
        matchedRows: plan.matchedRows,
        warnings: plan.warnings,
        repairs: plan.repairs,
      },
      null,
      2,
    ) + '\n',
  )

  const writes = plan.changes.filter((c) => c.after !== null)
  // Record files precede definitions, so capture switches only after records exist.
  writes.sort((a, b) => Number(a.path.endsWith('.md')) - Number(b.path.endsWith('.md')))
  for (const change of writes) {
    await checkUnchanged(change)
    await mkdir(path.dirname(change.path), { recursive: true })
    const temporary = `${change.path}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, change.after!, { flag: 'wx' })
      await rename(temporary, change.path)
    } finally {
      await unlink(temporary).catch(() => {})
    }
  }
  for (const change of writes) {
    if ((await readTextFile(change.path)) !== change.after)
      throw new Error(`Output verification failed: ${change.path}`)
  }
  for (const change of plan.changes.filter((c) => c.after === null)) {
    await checkUnchanged(change)
    await unlink(change.path)
    let dir = path.dirname(change.path)
    while (dir.split(path.sep).includes('_tracking')) {
      try {
        await rmdir(dir)
      } catch {
        break
      }
      dir = path.dirname(dir)
    }
  }
  return backup
}
