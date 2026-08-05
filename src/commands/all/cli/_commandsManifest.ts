import { existsSync } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import * as path from 'node:path'
import colors from 'picocolors'
import { isAIChatTool } from '#commands/lib/AIChatTool.ts'
import type { ParamDef, ParamKind, ParamType, ParamsRecord } from '#commands/lib/params.ts'
import { DIR_CODE_SRC, DIR_HOME, COMMAND_DIRS } from '#config'
import { readTextFile, writeTextFile } from '#shared/fs/mod.ts'
import { walk } from '#shared/fs/mod.ts'

export interface FlagEntry {
  name: string
  short?: string
  kind: ParamKind
  type: ParamType
  description: string
  optional?: boolean
}

export interface CommandEntry {
  name: string
  /** Absolute path to command .ts file */
  file: string
  description: string
  flags: FlagEntry[]
  /** True if the command class is decorated with @AIChatTool() */
  aiChatTool: boolean
}

export interface CommandsManifest {
  version: 2
  commands: {
    core: CommandEntry[]
    local: CommandEntry[]
    global: CommandEntry[]
  }
}

const COMMANDS_DIR = path.join(DIR_CODE_SRC, 'commands', 'all')
const SKY_DIR = path.join(DIR_HOME, '.sky')
const MANIFEST_PATH = path.join(SKY_DIR, 'sky.commands.json')

/** Derive command name from file path relative to commands/all/ */
function pathToCommandName(relPath: string): string {
  let name = relPath.replace(/\.ts$/, '')
  if (name.endsWith('/mod')) name = name.slice(0, -4)
  return name.replace(/\//g, ':')
}

/** Convert camelCase to kebab-case */
function toKebabCase(str: string): string {
  return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
}

/** Extract serializable flag info from params */
function extractFlags(params: ParamsRecord | undefined): FlagEntry[] {
  if (!params) return []
  const flags: FlagEntry[] = []
  for (const [name, def] of Object.entries(params) as [string, ParamDef][]) {
    if (def.hidden) continue
    const entry: FlagEntry = {
      name: toKebabCase(name),
      kind: def.kind,
      type: def.type,
      description: def.description.split('\n')[0],
    }
    if (def.short) entry.short = def.short
    if (def.optional) entry.optional = true
    flags.push(entry)
  }
  return flags
}

/**
 * Import a command file and build its manifest entry. Warns loudly to stderr on
 * import failure (never throws) and returns a stub entry. Without this, a broken
 * command — e.g. an external command whose group `node_modules` aren't installed,
 * so `@skywrite/*` can't resolve — vanishes silently from discovery, including
 * from ai:chat tool exposure (where `aiChatTool` would be stuck false).
 */
async function buildCommandEntry(name: string, file: string): Promise<CommandEntry> {
  let description = ''
  let flags: FlagEntry[] = []
  let aiChatTool = false
  try {
    const mod = await import(file)
    const cmd = mod.default
    if (cmd?.description) {
      description = cmd.description.description ?? ''
      flags = extractFlags(cmd.description.params)
    }
    if (cmd) aiChatTool = isAIChatTool(cmd)
  } catch (err) {
    console.warn(
      colors.yellow(`⚠ [sky] command scan: failed to import "${name}" (${file}) — ${(err as Error).message}`),
    )
  }
  return { name, file, description, flags, aiChatTool }
}

/** Walk commands/all/ and discover all command entry points */
async function discoverCommands(): Promise<CommandEntry[]> {
  const commands: CommandEntry[] = []

  for await (const entry of walk(COMMANDS_DIR)) {
    if (!entry.isFile) continue
    if (!entry.path.endsWith('.ts')) continue

    const relPath = path.relative(COMMANDS_DIR, entry.path)

    // Skip test files, private files/dirs, and lib directories
    if (relPath.includes('_test.')) continue
    if (relPath.split('/').some((seg) => seg.startsWith('_'))) continue
    if (relPath.split('/').includes('lib')) continue

    const name = pathToCommandName(relPath)
    commands.push(await buildCommandEntry(name, entry.path))
  }

  commands.sort((a, b) => a.name.localeCompare(b.name))
  return commands
}

/** Discover commands from extra commandDirs (from config) */
async function discoverExtraCommands(): Promise<CommandEntry[]> {
  const commands: CommandEntry[] = []
  for (const dir of COMMAND_DIRS) {
    if (!existsSync(dir)) continue
    for await (const entry of walk(dir)) {
      if (!entry.isFile || !entry.path.endsWith('.ts')) continue
      const relPath = path.relative(dir, entry.path)
      if (relPath.includes('_test.')) continue
      if (relPath.split('/').some((seg) => seg.startsWith('_'))) continue
      if (relPath.split('/').includes('lib')) continue

      const name = pathToCommandName(relPath)
      commands.push(await buildCommandEntry(name, entry.path))
    }
  }
  commands.sort((a, b) => a.name.localeCompare(b.name))
  return commands
}

/** Build and write the manifest */
export async function buildManifest(): Promise<CommandsManifest> {
  await mkdir(SKY_DIR, { recursive: true })
  const core = await discoverCommands()
  const local = await discoverExtraCommands()
  const manifest: CommandsManifest = {
    version: 2,
    commands: { core, local, global: [] },
  }
  await writeTextFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n')
  return manifest
}

/** Read existing manifest from disk. Falls back to full build if missing. */
export async function getManifest(): Promise<CommandsManifest> {
  try {
    const text = await readTextFile(MANIFEST_PATH)
    const manifest = JSON.parse(text) as CommandsManifest
    if (manifest.version !== 2) return buildManifest()
    return manifest
  } catch {
    return buildManifest()
  }
}

/** Incrementally walk a base dir, reusing cached entries when files haven't changed since manifestMtime. */
async function walkIncremental(
  baseDir: string,
  prevEntries: CommandEntry[],
  manifestMtime: number,
): Promise<{ commands: CommandEntry[]; changed: boolean }> {
  const cached = new Map<string, CommandEntry>()
  for (const cmd of prevEntries) cached.set(cmd.file, cmd)

  const commands: CommandEntry[] = []
  let changed = false

  for await (const entry of walk(baseDir)) {
    if (!entry.isFile || !entry.path.endsWith('.ts')) continue
    const relPath = path.relative(baseDir, entry.path)
    if (relPath.includes('_test.')) continue
    if (relPath.split('/').some((seg) => seg.startsWith('_'))) continue
    if (relPath.split('/').includes('lib')) continue

    const prev = cached.get(entry.path)
    cached.delete(entry.path)

    const fileMtime = (await stat(entry.path)).mtimeMs
    if (fileMtime <= manifestMtime && prev) {
      commands.push(prev)
      continue
    }

    changed = true
    commands.push(await buildCommandEntry(pathToCommandName(relPath), entry.path))
  }

  if (cached.size > 0) changed = true
  return { commands, changed }
}

/** Incrementally update: only re-import commands whose files are newer than the manifest */
export async function updateManifest(): Promise<CommandsManifest> {
  let existing: CommandsManifest | null = null
  let manifestMtime = 0
  try {
    const [text, s] = await Promise.all([readTextFile(MANIFEST_PATH), stat(MANIFEST_PATH)])
    existing = JSON.parse(text) as CommandsManifest
    manifestMtime = s.mtimeMs
  } catch {
    return buildManifest()
  }

  if (existing.version !== 2) return buildManifest()

  const coreResult = await walkIncremental(COMMANDS_DIR, existing.commands.core, manifestMtime)

  const localCommands: CommandEntry[] = []
  let localChanged = false
  // Track which configured dirs actually exist so removals trigger a rewrite.
  const prevLocalDirs = new Set<string>()
  for (const cmd of existing.commands.local) {
    for (const dir of COMMAND_DIRS) {
      if (cmd.file.startsWith(dir + path.sep)) prevLocalDirs.add(dir)
    }
  }
  for (const dir of COMMAND_DIRS) {
    if (!existsSync(dir)) {
      if (prevLocalDirs.has(dir)) localChanged = true
      continue
    }
    const prevForDir = existing.commands.local.filter((c) => c.file.startsWith(dir + path.sep))
    const result = await walkIncremental(dir, prevForDir, manifestMtime)
    localCommands.push(...result.commands)
    if (result.changed) localChanged = true
  }
  // Detect entries from dirs no longer in COMMAND_DIRS.
  if (existing.commands.local.length !== localCommands.length && !localChanged) {
    const knownFiles = new Set(localCommands.map((c) => c.file))
    if (existing.commands.local.some((c) => !knownFiles.has(c.file))) localChanged = true
  }

  const global = existing.commands.global ?? []

  if (!coreResult.changed && !localChanged) return existing

  coreResult.commands.sort((a, b) => a.name.localeCompare(b.name))
  localCommands.sort((a, b) => a.name.localeCompare(b.name))
  const manifest: CommandsManifest = {
    version: 2,
    commands: { core: coreResult.commands, local: localCommands, global },
  }
  await mkdir(SKY_DIR, { recursive: true })
  await writeTextFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n')
  return manifest
}
