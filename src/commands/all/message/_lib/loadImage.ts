import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { runCommand } from '#lib/sys/mod.ts'
import { exists } from '#shared/fs/mod.ts'

const HEIC_EXTENSIONS = new Set(['.heic', '.heif'])

export interface LoadedImage {
  image: Buffer
  mediaType: string
}

export function mediaTypeFromExt(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  return 'image/png'
}

/**
 * Read an image file for an AI vision request. HEIC/HEIF is converted to PNG
 * first (the Anthropic API doesn't accept HEIC) via macOS `sips`.
 */
export async function loadImageForAI(filePath: string): Promise<LoadedImage> {
  const ext = path.extname(filePath)
  if (!HEIC_EXTENSIONS.has(ext.toLowerCase())) {
    return { image: await readFile(filePath), mediaType: mediaTypeFromExt(filePath) }
  }

  const tempDir = await mkdtemp(path.join(tmpdir(), 'sky-heic-'))
  try {
    const outPath = path.join(tempDir, `${path.basename(filePath, ext)}.png`)
    const result = await runCommand('sips', ['-s', 'format', 'png', filePath, '--out', outPath])
    if (!result.success || !(await exists(outPath))) {
      const detail = (result.stderr || result.stdout).trim()
      throw new Error(
        `HEIC → PNG conversion failed for ${filePath} (requires macOS sips)${detail ? `: ${detail}` : ''}`,
      )
    }
    return { image: await readFile(outPath), mediaType: 'image/png' }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}
