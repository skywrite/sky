/**
 * The front matter as the identity line and the rail both see it: its rows, where each name
 * points, and one commit that writes the body back — trimmed to the block's convention.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { type Resolved, resolveNames } from './complete.ts'
import { ENTITY_KINDS } from './kinds.ts'
import { isEmptyFrontmatter, readFrontmatter, type Row } from './model.ts'

export interface FrontmatterState {
  /** The body as it is; '' when the document has no block */
  body: string
  rows: Row[]
  /** Why the YAML could not be read as rows */
  error?: string
  resolved: Record<string, Resolved | null>
  /** The key whose control should take focus on its next render */
  focusKey: string | null
  setFocusKey: (key: string | null) => void
  /** Writes a new body; a body without keys removes the block */
  commit: (text: string) => void
  /** Rewrites the body from its latest text, so changes made one after another each see the last */
  update: (change: (body: string) => string) => void
  readOnly: boolean
}

export function useFrontmatter(
  text: string | null,
  file: string,
  onChange?: (text: string | null) => void,
): FrontmatterState {
  const body = text ?? ''
  const parsed = useMemo(() => readFrontmatter(body), [body])
  const rows = parsed.rows
  const [resolved, setResolved] = useState<Record<string, Resolved | null>>({})
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const names = useMemo(() => {
    const out = new Set<string>()
    for (const row of rows) {
      if (!ENTITY_KINDS[row.kind] || row.kind === 'tags' || !Array.isArray(row.value)) continue
      for (const chip of row.value) out.add(chip)
    }
    return [...out].toSorted()
  }, [rows])
  const namesKey = names.join('\n')
  useEffect(() => {
    if (names.length === 0) return
    let alive = true
    void resolveNames(names, file).then((found) => {
      if (alive) setResolved((previous) => ({ ...previous, ...found }))
    })
    return () => {
      alive = false
    }
  }, [namesKey, file]) // eslint-disable-line react-hooks/exhaustive-deps -- names is derived from namesKey
  // What the body is right now — a commit's text before the page has re-rendered with it.
  const latest = useRef(body)
  latest.current = body
  const commit = (next: string) => {
    if (!onChange) return
    // The block's text has no trailing newline; the YAML document's does.
    const trimmed = next.replace(/\n$/, '')
    latest.current = trimmed
    onChange(isEmptyFrontmatter(trimmed) ? null : trimmed)
  }
  const update = (change: (body: string) => string) => commit(change(latest.current))
  return { body, rows, error: parsed.error, resolved, focusKey, setFocusKey, commit, update, readOnly: !onChange }
}
