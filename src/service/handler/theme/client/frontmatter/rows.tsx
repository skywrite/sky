/**
 * The rows of the front matter, wherever they show: chips with completion, text committed on a
 * pause, a picker of a key's values, the raw YAML face, and the add-property field.
 */

import { Autocomplete, Textarea, TextInput } from '@mantine/core'
import { Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { When } from '#universal/dates/nbdt/mod.ts'
import { ChipsInput } from './ChipsInput.tsx'
import { type Completion, fetchCompletions, type Resolved, timeZones } from './complete.ts'
import { CHIP_KINDS, ENTITY_KINDS, type RowKind, suggestedKeys, TYPE_MARKS } from './kinds.ts'
import { readFrontmatter, removeKey, type Row, writeChildValue, writeValue } from './model.ts'

const IDLE_COMMIT_MS = 700
const SEARCH_DEBOUNCE_MS = 80
const FOLD_LENGTH = 160
const URL_RE = /^https?:\/\/\S+$/i

/** The explorer page for a notebook path. */
export function hrefOf(path: string): string {
  return `/explorer/${path.split('/').map(encodeURIComponent).join('/')}`
}

/** The file route for a file named beside the document. */
function fileHrefOf(file: string, name: string): string {
  const dir = file.split('/').slice(0, -1)
  return `/docs/_api/file/${[...dir, name].map(encodeURIComponent).join('/')}`
}

/** What a `when` value reads as: the weekday and the length, or that it does not parse. */
function whenHint(value: string): { text: string; ok: boolean } | null {
  if (value.trim().length === 0) return null
  let when: When
  try {
    when = When.fromYaml(value.trim())
  } catch {
    return { text: 'not a date or a range', ok: false }
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim())
  const parts: string[] = []
  if (match) {
    const day = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    parts.push(day.toLocaleDateString(undefined, { weekday: 'short' }))
  }
  const minutes = when.durationMinutes
  if (minutes !== null && minutes > 0) {
    const hours = Math.floor(minutes / 60)
    const rest = minutes % 60
    parts.push(hours > 0 ? (rest > 0 ? `${hours} h ${rest} min` : `${hours} h`) : `${rest} min`)
  }
  return parts.length > 0 ? { text: parts.join(' · '), ok: true } : null
}

/** Completions for a search, a moment after it settles. */
export function useCompletions(
  kind: Parameters<typeof fetchCompletions>[0] | null,
  search: string,
  options: { key?: string; dir?: string },
): Completion[] {
  const [items, setItems] = useState<Completion[]>([])
  const { key, dir } = options
  useEffect(() => {
    if (!kind) return
    let alive = true
    const timer = window.setTimeout(() => {
      void fetchCompletions(kind, search, { key, dir }).then((found) => {
        if (alive) setItems(found)
      })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [kind, search, key, dir])
  return items
}

export function Mark({ type }: { type: string | undefined }) {
  const mark = type ? TYPE_MARKS[type] : undefined
  return mark ? <span className="sky-prop-mark">{mark}</span> : null
}

/** A suggestion's mark column — always there, so the label keeps its column even without a mark. */
export function OptionMark({ type }: { type: string | undefined }) {
  return <span className="sky-prop-mark">{type ? (TYPE_MARKS[type] ?? '') : ''}</span>
}

export function Chip({
  value,
  resolved,
  entity,
  file,
  kind,
}: {
  value: string
  resolved?: Resolved | null
  entity: boolean
  file: string
  kind: RowKind
}) {
  if (kind === 'files') {
    return (
      <a className="sky-prop-chip file" href={fileHrefOf(file, value)} target="_blank" rel="noreferrer">
        {value}
      </a>
    )
  }
  if (resolved) {
    return (
      <a className="sky-prop-chip link" href={hrefOf(resolved.path)}>
        <Mark type={resolved.type} />
        {value}
      </a>
    )
  }
  if (kind === 'tags') return <span className="sky-prop-chip">{value}</span>
  return (
    <span
      className={`sky-prop-chip${entity && resolved === null ? ' new' : ''}`}
      title={entity && resolved === null ? 'Not in the notebook yet' : undefined}
    >
      {entity && resolved === null ? <span className="sky-prop-mark">?</span> : null}
      {value}
    </span>
  )
}

export function ChipsRow({
  row,
  file,
  dir,
  readOnly,
  resolved,
  autoFocus,
  onCommit,
}: {
  row: Row
  file: string
  dir: string
  readOnly: boolean
  resolved: Record<string, Resolved | null>
  autoFocus: boolean
  onCommit: (chips: string[]) => void
}) {
  const chips = Array.isArray(row.value) ? row.value : []
  const entityKind = ENTITY_KINDS[row.kind] ?? null
  const [search, setSearch] = useState('')
  const items = useCompletions(readOnly ? null : entityKind, search, { dir })
  if (readOnly || row.kind === 'files') {
    return (
      <div className="sky-prop-chips">
        {chips.map((chip) => (
          <span key={chip} className="sky-prop-chip-wrap">
            <Chip value={chip} resolved={resolved[chip]} entity={entityKind !== null} file={file} kind={row.kind} />
            {!readOnly && (
              <button
                type="button"
                className="sky-prop-chip-remove"
                aria-label={`Remove ${chip}`}
                onClick={() => onCommit(chips.filter((c) => c !== chip))}
              >
                ×
              </button>
            )}
          </span>
        ))}
        {chips.length === 0 && readOnly ? <span className="sky-prop-empty">—</span> : null}
      </div>
    )
  }
  return (
    <ChipsInput
      className="sky-prop-tags"
      chips={chips}
      options={items}
      search={search}
      onSearch={setSearch}
      onChange={onCommit}
      splitChars={row.kind === 'tags' ? [';', ','] : [',']}
      autoFocus={autoFocus}
      placeholder="Add…"
      chipPrefix={(chip) => {
        const hit = resolved[chip]
        if (hit) return <Mark type={hit.type} />
        return entityKind !== null && entityKind !== 'tags' && hit === null ? (
          <span className="sky-prop-mark">?</span>
        ) : null
      }}
      renderOption={(option) => (
        <span className="sky-prop-option">
          <OptionMark type={option.type} />
          <span className="sky-prop-option-label">{option.label ?? option.value}</span>
          {option.hint || option.count ? (
            <span className="sky-prop-option-hint">{option.hint ?? `${option.count} docs`}</span>
          ) : null}
        </span>
      )}
    />
  )
}

/** A text-like row: local while typing, committed on blur, Enter, or a pause. */
export function TextRow({
  row,
  dir,
  readOnly,
  autoFocus,
  onCommit,
}: {
  row: Row
  dir: string
  readOnly: boolean
  autoFocus: boolean
  onCommit: (value: string) => void
}) {
  const value = typeof row.value === 'string' ? row.value : ''
  const [draft, setDraft] = useState(value)
  const [folded, setFolded] = useState(true)
  const committed = useRef(value)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => {
    committed.current = value
    setDraft(value)
  }, [value])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const commit = (next: string) => {
    window.clearTimeout(timer.current)
    if (next === committed.current) return
    committed.current = next
    onCommit(next)
  }
  const edit = (next: string) => {
    setDraft(next)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => commit(next), IDLE_COMMIT_MS)
  }
  const hint = row.kind === 'date' && row.key === 'when' ? whenHint(draft) : null

  if (readOnly || row.kind === 'auto') {
    if (row.kind === 'long' && value.length > FOLD_LENGTH) {
      return (
        <span className="sky-prop-long">
          {folded ? `${value.slice(0, FOLD_LENGTH).trimEnd()}… ` : `${value} `}
          <button type="button" className="sky-prop-more" onClick={() => setFolded(!folded)}>
            {folded ? 'more' : 'less'}
          </button>
        </span>
      )
    }
    return (
      <span className={`sky-prop-text${row.kind === 'auto' ? ' auto' : ''}`}>
        {URL_RE.test(value) ? (
          <a href={value} target="_blank" rel="noreferrer">
            {value}
          </a>
        ) : (
          value || <span className="sky-prop-empty">—</span>
        )}
        {row.kind === 'auto' && value ? <span className="sky-prop-hint">kept by Sky</span> : null}
        {hint ? <span className={`sky-prop-hint${hint.ok ? '' : ' bad'}`}>{hint.text}</span> : null}
      </span>
    )
  }
  const shared = {
    variant: 'unstyled' as const,
    size: 'sm' as const,
    autoFocus,
    value: draft,
    onBlur: () => commit(draft),
  }
  if (row.kind === 'long') {
    return (
      <Textarea
        {...shared}
        className="sky-prop-input"
        autosize
        minRows={1}
        onChange={(event) => edit(event.currentTarget.value)}
      />
    )
  }
  if (row.kind === 'picker') {
    return <PickerInput row={row} dir={dir} draft={draft} autoFocus={autoFocus} onEdit={edit} onCommit={commit} />
  }
  return (
    <span className="sky-prop-text-wrap">
      <TextInput
        {...shared}
        className="sky-prop-input"
        onChange={(event) => edit(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit(draft)
          }
        }}
      />
      {hint ? <span className={`sky-prop-hint${hint.ok ? '' : ' bad'}`}>{hint.text}</span> : null}
    </span>
  )
}

/** A value picked from what the key already has across the notebook — or typed. */
function PickerInput({
  row,
  dir,
  draft,
  autoFocus,
  onEdit,
  onCommit,
}: {
  row: Row
  dir: string
  draft: string
  autoFocus: boolean
  onEdit: (value: string) => void
  onCommit: (value: string) => void
}) {
  const items = useCompletions(row.key === 'tz' ? null : 'values', '', { key: row.key, dir })
  const data = useMemo(() => {
    if (row.key === 'tz') return timeZones()
    return items.map((item) => item.value)
  }, [items, row.key])
  return (
    <Autocomplete
      className="sky-prop-input"
      variant="unstyled"
      size="sm"
      autoFocus={autoFocus}
      value={draft}
      data={data}
      limit={12}
      onChange={onEdit}
      onOptionSubmit={onCommit}
      onBlur={() => onCommit(draft)}
      comboboxProps={{ withinPortal: true, shadow: 'md' }}
    />
  )
}

export function AddProperty({
  dir,
  present,
  onAdd,
}: {
  dir: string
  present: Set<string>
  onAdd: (key: string) => void
}) {
  const [search, setSearch] = useState('')
  const found = useCompletions('keys', search, { dir })
  const options = useMemo(() => {
    const seen = new Set<string>()
    const out: { value: string; count?: number }[] = []
    for (const item of [...suggestedKeys(dir).map((key) => ({ value: key })), ...found]) {
      if (present.has(item.value) || seen.has(item.value)) continue
      seen.add(item.value)
      out.push(item)
    }
    return search.length === 0 ? out : out.filter((item) => item.value.toLowerCase().includes(search.toLowerCase()))
  }, [dir, found, present, search])
  return (
    <ChipsInput
      className="sky-props-add-input"
      chips={[]}
      options={options}
      search={search}
      onSearch={setSearch}
      onChange={(next) => {
        const key = next[0]?.trim() ?? ''
        if (/^[A-Za-z_][\w-]*$/.test(key)) onAdd(key)
      }}
      splitChars={[]}
      placeholder="+ Add property"
      renderOption={(option) => (
        <span className="sky-prop-option">
          <OptionMark type={undefined} />
          <span className="sky-prop-option-label">{option.value}</span>
          {option.count ? <span className="sky-prop-option-hint">{option.count} docs</span> : null}
        </span>
      )}
    />
  )
}

/** The raw YAML, typed straight into the block: committed on blur or a pause. */
export function YamlFace({
  text,
  readOnly,
  onCommit,
}: {
  text: string
  readOnly: boolean
  onCommit: (text: string) => void
}) {
  const [draft, setDraft] = useState(text)
  const committed = useRef(text)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => {
    committed.current = text
    setDraft(text)
  }, [text])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const commit = (next: string) => {
    window.clearTimeout(timer.current)
    if (next === committed.current) return
    committed.current = next
    onCommit(next)
  }
  const error = readFrontmatter(draft).error
  if (readOnly) return <pre className="sky-props-yaml">{text}</pre>
  return (
    <div className="sky-props-yaml-edit">
      <Textarea
        variant="unstyled"
        autosize
        minRows={2}
        className="sky-props-yaml-input"
        value={draft}
        spellCheck={false}
        onChange={(event) => {
          const next = event.currentTarget.value
          setDraft(next)
          window.clearTimeout(timer.current)
          timer.current = window.setTimeout(() => commit(next), IDLE_COMMIT_MS)
        }}
        onBlur={() => commit(draft)}
      />
      {error ? <p className="sky-props-error">{error}</p> : null}
    </div>
  )
}

/** One row's chrome: the key, its control, and — editing — the remove button; a map's children beneath. */
export function PropRow({
  row,
  file,
  readOnly,
  resolved,
  focusKey,
  body,
  commit,
  parentKey,
}: {
  row: Row
  file: string
  readOnly: boolean
  resolved: Record<string, Resolved | null>
  focusKey: string | null
  body: string
  commit: (text: string) => void
  parentKey?: string
}) {
  const dir = file.split('/')[0] ?? ''
  const id = parentKey ? `${parentKey}.${row.key}` : row.key
  const isChips = CHIP_KINDS.has(row.kind) || row.kind === 'files'
  let control: ReactNode
  if (row.kind === 'map') control = null
  else if (isChips) {
    control = (
      <ChipsRow
        row={row}
        file={file}
        dir={dir}
        readOnly={readOnly}
        resolved={resolved}
        autoFocus={focusKey === id}
        onCommit={(chips) => commit(writeValue(body, row.key, row.kind, chips))}
      />
    )
  } else {
    control = (
      <TextRow
        row={row}
        dir={dir}
        readOnly={readOnly}
        autoFocus={focusKey === id}
        onCommit={(value) =>
          commit(
            parentKey ? writeChildValue(body, parentKey, row.key, value) : writeValue(body, row.key, row.kind, value),
          )
        }
      />
    )
  }
  return (
    <div className={`sky-prop${parentKey ? ' sub' : ''}`} data-key={id} data-kind={row.kind}>
      <span className="sky-prop-key">{row.key}</span>
      <div className="sky-prop-value">{control}</div>
      {!readOnly && !parentKey ? (
        <button
          type="button"
          className="sky-prop-remove"
          aria-label={`Remove ${row.key}`}
          title="Remove"
          onClick={() => commit(removeKey(body, row.key))}
        >
          ×
        </button>
      ) : null}
      {row.kind === 'map' && row.children ? (
        <div className="sky-prop-children">
          {row.children.map((child) => (
            <Fragment key={child.key}>
              <PropRow
                row={child}
                file={file}
                readOnly={readOnly}
                resolved={resolved}
                focusKey={focusKey}
                body={body}
                commit={commit}
                parentKey={row.key}
              />
            </Fragment>
          ))}
        </div>
      ) : null}
    </div>
  )
}
