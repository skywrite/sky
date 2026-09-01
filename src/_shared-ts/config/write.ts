import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import * as path from 'node:path'
import { applyEdits, modify, parse } from 'jsonc-parser'
import { SKY_CONFIG_PATH } from './loader.ts'

/**
 * One value into ~/.sky/config.jsonc, everything else left alone.
 *
 * jsonc-parser edits the text rather than reparsing it, so the comments and
 * formatting `sky init` wrote — and any hand edits — survive. The write is
 * atomic: a sibling temp file, then a rename.
 */

/** What a missing file starts as. */
const NEW_FILE = '// Sky configuration — https://github.com/skywrite/sky\n{\n}\n'

export function setConfigValue(keyPath: string[], value: unknown, configPath = SKY_CONFIG_PATH): void {
  const text = existsSync(configPath) ? readFileSync(configPath, 'utf-8') : NEW_FILE
  const edits = modify(text, keyPath, value, {
    formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' },
  })
  const next = applyEdits(text, edits)
  mkdirSync(path.dirname(configPath), { recursive: true })
  const tmp = `${configPath}.tmp-${process.pid}`
  writeFileSync(tmp, next)
  renameSync(tmp, configPath)
}

/** Removes one key — and then any object the removal leaves empty, so no `"ai": {}` shells linger. */
export function removeConfigValue(keyPath: string[], configPath = SKY_CONFIG_PATH): void {
  if (!existsSync(configPath)) return
  setConfigValue(keyPath, undefined, configPath)
  for (let depth = keyPath.length - 1; depth > 0; depth--) {
    const parent = keyPath.slice(0, depth)
    let cursor: unknown = parse(readFileSync(configPath, 'utf-8'))
    for (const part of parent) {
      cursor = cursor !== null && typeof cursor === 'object' ? (cursor as Record<string, unknown>)[part] : undefined
    }
    const empty =
      cursor !== null && typeof cursor === 'object' && !Array.isArray(cursor) && Object.keys(cursor).length === 0
    if (!empty) break
    setConfigValue(parent, undefined, configPath)
  }
}
