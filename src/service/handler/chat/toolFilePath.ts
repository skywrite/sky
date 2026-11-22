import { homedir } from 'node:os'
import * as path from 'node:path'
import { resolveFilePath } from '#commands/lib/chat/fileTools.ts'
import { FILE_DAY } from '#shared/nbfs/layout/types.ts'
import { toTimeRef } from '#shared/nbfs/timeRef.ts'

export interface ToolFilePath {
  absolute: string
  label: string
  date?: string
}

function pathField(value: unknown): string | undefined {
  if (value && typeof value === 'object' && 'path' in value && typeof value.path === 'string' && value.path.trim()) {
    return value.path
  }
  return undefined
}

export function toolFilePath(tool: string, input: unknown, output: unknown, baseDir: string): ToolFilePath | undefined {
  if (tool !== 'read_file' && tool !== 'list_directory') return undefined
  const given = pathField(output) ?? pathField(input)
  if (!given) return undefined
  // Web chat resolves file tool inputs from the user's home. A completed read can report a resolved attachment instead.
  const absolute = resolveFilePath(given, homedir())
  const relative = path.relative(baseDir, absolute)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return { absolute, label: absolute }
  }
  if (relative.startsWith(`time${path.sep}`)) {
    try {
      // A listing can target the day directory itself. Probe a child so the same parser handles it and deeper folders.
      const probe = tool === 'list_directory' ? path.join(relative, FILE_DAY) : relative
      const [date] = toTimeRef(probe).split('/')
      return { absolute, label: path.basename(absolute), date }
    } catch {
      // A week, month, or year path has no single day.
    }
  }
  return { absolute, label: relative || '.' }
}
