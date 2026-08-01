import * as path from 'node:path'
import dirnameFilename from '#lib/util/dirnameFilename.ts'

const { __dirname } = dirnameFilename(import.meta.url)

/**
 * The /theme page — the living style guide.
 *
 * The client (React + Mantine) is bundled by Bun itself on first request and
 * served from memory: no build step, no artifacts, no watcher. The service
 * process restarting (which `--watch` already does on source changes) is the
 * cache invalidation.
 */

interface ThemeAsset {
  content: ArrayBuffer
  type: string
}

let assetsPromise: Promise<Map<string, ThemeAsset>> | null = null

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
  assetsPromise ??= buildAssets()
  try {
    return (await assetsPromise).get(name)
  } catch (err) {
    assetsPromise = null
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
