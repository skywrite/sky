import { existsSync } from 'node:fs'
import { lstat, readdir, realpath, stat } from 'node:fs/promises'
import * as path from 'node:path'
import type { BunPlugin } from 'bun'
import { EXTENSIONS_DIR, listInstalled } from '#lib/extensions/installed.ts'
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
 *
 * Installed extensions' screens compile into the same bundle: the build
 * replaces client/extensionsGenerated.ts with one import per extension that
 * has a ui/index.tsx, and an extension's imports of React and Mantine resolve
 * to Sky's own copies, so there is one React on the page. An extension whose
 * screens fail to compile costs only its screens: the bundle is built again
 * without extensions and the failure is kept for the Extensions page.
 */

interface ThemeAsset {
  content: ArrayBuffer
  type: string
}

const CLIENT_DIR = path.join(__dirname, 'client')
const GENERATED = path.join(CLIENT_DIR, 'extensionsGenerated.ts')

let built: { sourcesAt: number; assets: Promise<Map<string, ThemeAsset>> } | null = null
let extensionBuildError: string | null = null

/** The last extension build failure, in the bundler's words; null when the screens compiled. */
export function lastExtensionBuildError(): string | null {
  return extensionBuildError
}

type ScreenEntry = { id: string; slug: string; name: string; file: string; dir: string }

/** Installed, healthy extensions that have screens, by their real folders. */
async function extensionScreens(): Promise<ScreenEntry[]> {
  const entries: ScreenEntry[] = []
  for (const e of await listInstalled()) {
    if (e.problem || !e.enabled) continue
    const dir = await realpath(e.dir)
    const file = path.join(dir, 'ui', 'index.tsx')
    if (existsSync(file)) entries.push({ id: e.id, slug: e.slug, name: e.manifest.sky.name, file, dir })
  }
  return entries
}

function generatedModule(entries: ScreenEntry[]): string {
  const imports = entries.map((e, i) => `import * as e${i} from ${JSON.stringify(e.file)}`)
  const rows = entries.map(
    (e, i) =>
      `  { id: ${JSON.stringify(e.id)}, slug: ${JSON.stringify(e.slug)}, name: ${JSON.stringify(e.name)}, ui: e${i} },`,
  )
  return `${imports.join('\n')}\nexport const extensionModules = [\n${rows.join('\n')}\n]\n`
}

function extensionsPlugin(entries: ScreenEntry[]): BunPlugin {
  return {
    name: 'sky-extensions',
    setup(build) {
      build.onLoad({ filter: /extensionsGenerated\.ts$/ }, (args) =>
        args.path === GENERATED ? { loader: 'ts', contents: generatedModule(entries) } : undefined,
      )
    },
  }
}

/** The newest mtime among the client sources and the installed extensions' screens — a few dozen stats per request. */
async function clientSourcesAt(): Promise<number> {
  let latest = 0
  for (const name of await readdir(CLIENT_DIR, { recursive: true })) {
    const info = await stat(path.join(CLIENT_DIR, name))
    latest = Math.max(latest, info.mtimeMs)
  }
  if (existsSync(EXTENSIONS_DIR)) {
    latest = Math.max(latest, (await stat(EXTENSIONS_DIR)).mtimeMs)
    for (const author of await readdir(EXTENSIONS_DIR)) {
      const authorDir = path.join(EXTENSIONS_DIR, author)
      latest = Math.max(latest, (await lstat(authorDir)).mtimeMs)
    }
    for (const entry of await extensionScreens()) {
      const uiDir = path.dirname(entry.file)
      for (const name of await readdir(uiDir, { recursive: true })) {
        latest = Math.max(latest, (await stat(path.join(uiDir, name))).mtimeMs)
      }
    }
  }
  return latest
}

async function buildAssets(): Promise<Map<string, ThemeAsset>> {
  const build = (entries: ScreenEntry[]) =>
    Bun.build({
      entrypoints: [path.join(__dirname, 'client/main.tsx')],
      target: 'browser',
      minify: true,
      plugins: [extensionsPlugin(entries)],
    })

  // Bun.build throws on a failed build; either way a failure with extensions
  // is retried without them, so the web app never depends on an extension.
  const screens = await extensionScreens().catch(() => [])
  const failure = (error: unknown) =>
    error instanceof AggregateError
      ? error.errors.map((e) => String(e)).join('\n')
      : error instanceof Error
        ? error.message
        : String(error)
  let result: Awaited<ReturnType<typeof build>> | null = null
  if (screens.length > 0) {
    try {
      result = await build(screens)
      extensionBuildError = result.success ? null : result.logs.map((log) => String(log)).join('\n')
      if (!result.success) result = null
    } catch (error) {
      extensionBuildError = failure(error)
    }
  } else {
    extensionBuildError = null
  }
  result ??= await build([])

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
