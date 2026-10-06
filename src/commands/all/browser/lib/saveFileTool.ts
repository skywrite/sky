import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, link, mkdir, readFile, stat, unlink } from 'node:fs/promises'
import * as path from 'node:path'
import { jsonSchema, tool } from 'ai'
import { resolveFilePath } from '#commands/lib/chat/fileTools.ts'

// save_file — a checked download leaves the task folder for where the task
// asked. The only file the model may move is one in that folder; the
// destination is anywhere the person could name themselves. Nothing is
// ever overwritten: a taken name gets a numbered suffix.

export const SAVE_FILE_TOOL = 'save_file'

export interface SaveFileOptions {
  /** The task's files folder — the only source */
  filesDir: string
  /** Where a relative destination resolves from — the person's shell directory */
  cwd: string
}

export interface SaveFileInput {
  path: string
  to: string
}

export type SaveFileOutput =
  | { success: true; savedTo: string; alreadyThere?: boolean }
  | { success: false; error: string }

const inside = (dir: string, file: string): boolean => {
  const rel = path.relative(dir, file)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

/** A free name beside the wanted one: `report.pdf`, `report (2).pdf`, `report (3).pdf` … */
async function freeName(wanted: string): Promise<string> {
  const ext = path.extname(wanted)
  const stem = wanted.slice(0, wanted.length - ext.length)
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? wanted : `${stem} (${n})${ext}`
    try {
      await stat(candidate)
    } catch {
      return candidate
    }
  }
}

const digest = async (file: string): Promise<string> =>
  createHash('sha256')
    .update(await readFile(file))
    .digest('hex')

/** Whether `to` exists with exactly the bytes of `from`. */
async function sameFile(from: string, to: string): Promise<boolean> {
  try {
    const [a, b] = await Promise.all([stat(from), stat(to)])
    if (!b.isFile() || a.size !== b.size) return false
    return (await digest(from)) === (await digest(to))
  } catch {
    return false
  }
}

async function move(from: string, to: string): Promise<void> {
  try {
    // Reserve the destination atomically: rename would overwrite a file created after freeName checked.
    await link(from, to)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
    await copyFile(from, to, constants.COPYFILE_EXCL)
  }
  await unlink(from)
}

export async function saveFile(input: SaveFileInput, options: SaveFileOptions): Promise<SaveFileOutput> {
  const from = path.isAbsolute(input.path) ? path.normalize(input.path) : path.join(options.filesDir, input.path)
  if (!inside(options.filesDir, from))
    return { success: false, error: `Only files in ${options.filesDir} can be saved` }
  try {
    if (!(await stat(from)).isFile()) return { success: false, error: `${from} is not a file` }
  } catch {
    return { success: false, error: `No such file: ${from}` }
  }
  let to = resolveFilePath(input.to, options.cwd)
  const wantsDir =
    input.to.trim().endsWith('/') ||
    (await stat(to)
      .then((s) => s.isDirectory())
      .catch(() => false))
  if (wantsDir) to = path.join(to, path.basename(from))
  await mkdir(path.dirname(to), { recursive: true })
  // The same bytes already there, from an earlier run: nothing to add, and no "(2)" copy.
  if (await sameFile(from, to)) {
    await unlink(from)
    return { success: true, savedTo: to, alreadyThere: true }
  }
  for (;;) {
    const savedTo = await freeName(to)
    try {
      await move(from, savedTo)
      return { success: true, savedTo }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
}

export function createSaveFileTool(options: SaveFileOptions): Record<string, unknown> {
  return {
    [SAVE_FILE_TOOL]: tool({
      description:
        'Move a checked file from the task folder to where the task asks. Creates folders as needed and never overwrites: a taken name gets a numbered suffix, unless the very same file is already there, in which case it reports that path. Returns the final path.',
      inputSchema: jsonSchema<SaveFileInput>({
        type: 'object',
        properties: {
          path: { type: 'string', description: 'The file in the task folder, by name or full path' },
          to: {
            type: 'string',
            description: 'Destination folder (ending in /) or file path; ~ and relative paths work',
          },
        },
        required: ['path', 'to'],
      }),
      execute: (input: SaveFileInput) => saveFile(input, options),
    }),
  }
}
