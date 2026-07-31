import { execFile } from 'node:child_process'
import { readFile, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { promisify } from 'node:util'
import { exists, makeTempDir } from '#shared/fs/mod.ts'
import { CHROMIUM_PATHS } from '../../lib/browserSession.ts'

// Rasterizes agent-authored SVG into PNG background art using whatever the
// machine already has — no bundled renderer. Fidelity order: librsvg is fast
// and purpose-built, a Chromium browser renders reference-quality filters,
// QuickLook always exists on macOS as the last resort.

const execFileAsync = promisify(execFile)

const RSVG_PATHS = ['/opt/homebrew/bin/rsvg-convert', '/usr/local/bin/rsvg-convert', '/usr/bin/rsvg-convert']

const QLMANAGE_PATH = '/usr/bin/qlmanage'

const MAX_SVG_CHARS = 262_144
const RENDER_TIMEOUT_MS = 20_000

/**
 * Reject SVG the renderers should never see. The SVG is agent-authored and
 * rendered locally, so the bar is self-containment: no scripts, no fetches
 * of external resources, no HTML embedding.
 */
export function validateSvgSource(svg: string): string | null {
  if (!svg.trim()) return 'svg is empty'
  if (svg.length > MAX_SVG_CHARS) return `svg is too large (${svg.length} chars > ${MAX_SVG_CHARS})`
  if (!/<svg[\s>]/i.test(svg)) return 'not an <svg> document'
  // Namespace declarations are the one legitimate absolute-URL use in SVG.
  const lowered = svg
    .replace(/xmlns(?::[a-z0-9]+)?\s*=\s*("[^"]*"|'[^']*')/gi, '')
    .replace(/<!doctype[^>]*>/gi, '')
    .toLowerCase()
  for (const banned of ['<script', 'javascript:', 'http://', 'https://', '<foreignobject']) {
    if (lowered.includes(banned)) return `svg must be self-contained — remove ${banned}`
  }
  return null
}

export interface SvgRenderer {
  kind: 'rsvg' | 'chromium' | 'qlmanage'
  binary: string
}

export async function findSvgRenderer(): Promise<SvgRenderer | null> {
  for (const binary of RSVG_PATHS) {
    if (await exists(binary)) return { kind: 'rsvg', binary }
  }
  for (const binary of CHROMIUM_PATHS) {
    if (await exists(binary)) return { kind: 'chromium', binary }
  }
  if (await exists(QLMANAGE_PATH)) return { kind: 'qlmanage', binary: QLMANAGE_PATH }
  return null
}

/** Render SVG markup to PNG bytes at the given pixel size. Throws with a user-readable message. */
export async function svgToPng(
  svg: string,
  options: { width: number; height: number; renderer?: SvgRenderer },
): Promise<Uint8Array> {
  const renderer = options.renderer ?? (await findSvgRenderer())
  if (!renderer) {
    throw new Error('No SVG renderer available (need rsvg-convert, a Chromium-family browser, or qlmanage)')
  }

  const dir = await makeTempDir({ prefix: 'sky-svg-' })
  const svgPath = path.join(dir, 'art.svg')
  const pngPath = path.join(dir, 'art.png')
  try {
    await writeFile(svgPath, svg, 'utf8')
    if (renderer.kind === 'rsvg') {
      await execFileAsync(
        renderer.binary,
        ['-w', String(options.width), '-h', String(options.height), '-o', pngPath, svgPath],
        { timeout: RENDER_TIMEOUT_MS },
      )
    } else if (renderer.kind === 'chromium') {
      await execFileAsync(
        renderer.binary,
        [
          '--headless=new',
          '--disable-gpu',
          '--hide-scrollbars',
          `--window-size=${options.width},${options.height}`,
          `--screenshot=${pngPath}`,
          `file://${svgPath}`,
        ],
        { timeout: RENDER_TIMEOUT_MS },
      )
    } else {
      // qlmanage writes <name>.svg.png into the output dir at max dimension -s
      await execFileAsync(
        renderer.binary,
        ['-t', '-s', String(Math.max(options.width, options.height)), '-o', dir, svgPath],
        { timeout: RENDER_TIMEOUT_MS },
      )
      const qlOut = path.join(dir, 'art.svg.png')
      return new Uint8Array(await readFile(qlOut))
    }
    return new Uint8Array(await readFile(pngPath))
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}
