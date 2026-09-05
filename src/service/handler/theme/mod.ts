import { readdir, stat } from 'node:fs/promises'
import * as path from 'node:path'
import dirnameFilename from '#lib/util/dirnameFilename.ts'

const { __dirname } = dirnameFilename(import.meta.url)

/**
 * The web app's client bundle and its shell HTML.
 *
 * The client (React + Mantine) is bundled by Bun itself on first request and
 * served from memory: no build step, no artifacts. The client sources under
 * ./client are build entrypoints read from disk, not imports, so `--watch`
 * never sees them change — instead their mtimes are checked on each asset
 * request and the bundle rebuilds when any of them is newer. Editing the
 * client and reloading the page is enough.
 */

interface ThemeAsset {
  content: ArrayBuffer
  type: string
}

const CLIENT_DIR = path.join(__dirname, 'client')

let built: { sourcesAt: number; assets: Promise<Map<string, ThemeAsset>> } | null = null

/** The newest mtime among the client sources, subdirectories included — a few dozen stats per request. */
async function clientSourcesAt(): Promise<number> {
  let latest = 0
  for (const name of await readdir(CLIENT_DIR, { recursive: true })) {
    const info = await stat(path.join(CLIENT_DIR, name))
    latest = Math.max(latest, info.mtimeMs)
  }
  return latest
}

async function buildAssets(): Promise<Map<string, ThemeAsset>> {
  const result = await Bun.build({
    entrypoints: [path.join(__dirname, 'client/main.tsx')],
    target: 'browser',
    minify: true,
  })

  if (!result.success) {
    const detail = result.logs.map((log) => String(log)).join('\n')
    throw new Error(`theme client build failed:\n${detail}`)
  }

  const assets = new Map<string, ThemeAsset>()
  for (const output of result.outputs) {
    const name = path.basename(output.path)
    const type = name.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8'
    assets.set(name, { content: await output.arrayBuffer(), type })
  }
  return assets
}

export async function getThemeAsset(name: string): Promise<ThemeAsset | undefined> {
  const sourcesAt = await clientSourcesAt()
  if (!built || sourcesAt > built.sourcesAt) built = { sourcesAt, assets: buildAssets() }
  try {
    return (await built.assets).get(name)
  } catch (err) {
    built = null
    throw err
  }
}

export function renderAppHtml(title: string): string {
  return `<!doctype html>
<html lang="en" data-mantine-color-scheme="light">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <style>html { font-size: 112.5%; }</style>
    <link rel="stylesheet" href="/_assets/main.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/_assets/main.js"></script>
  </body>
</html>
`
}
