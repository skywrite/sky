import './links.css'
import { Button, Drawer, Modal, Select, TextInput } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import type { LinkItem, LinkSearch } from '../../links/types.ts'
import { LinkIcon } from './linkIcon.tsx'
import { RenderedHtml } from './renderedHtml.tsx'
import { renderStatic } from './wysiwyg/render.ts'

const KINDS = [
  { value: '', label: 'All types' },
  ...[
    'Video',
    'Meeting',
    'Chat',
    'Message',
    'Journal',
    'Note',
    'Day',
    'Person',
    'Org',
    'Project',
    'Place',
    'Library',
  ].map((label) => ({
    value: label.toLowerCase(),
    label: label === 'Person' ? 'People' : label === 'Library' ? 'Library' : `${label}s`,
  })),
]

async function request<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(
    url,
    body === undefined
      ? undefined
      : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
  )
  const data = (await response.json()) as T & { message?: string }
  if (!response.ok) throw new Error(data.message ?? 'Could not read notebook links.')
  return data
}

function href(file: string): string {
  return `/explorer/${file.split('/').map(encodeURIComponent).join('/')}`
}

function dateLabel(date: string | undefined, today: string): string {
  if (!date) return 'Elsewhere in the notebook'
  if (date === today) return 'Today'
  if (date === new PlainDate(today).addDays(-1).ymd) return 'Yesterday'
  return date
}

function Detail({ item }: { item: LinkItem }) {
  return (
    <>
      <span className="sky-link-meta">
        {[item.kind.charAt(0).toUpperCase() + item.kind.slice(1), item.date, item.people].filter(Boolean).join(' · ')}
      </span>
      {item.hint && <span className="sky-link-meta">{item.hint}</span>}
      {item.parent && (
        <span className="sky-link-meta">
          From turn {item.parent.turn} of {item.parent.title}
        </span>
      )}
    </>
  )
}

function Preview({ item }: { item: LinkItem }) {
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    setContent(null)
    setError(null)
    const file = item.path.split('/').map(encodeURIComponent).join('/')
    void request<{ content: string }>(`/docs/_api/content/${file}`)
      .then((data) => {
        if (alive) setContent(data.content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').slice(0, 16000))
      })
      .catch((failure: Error) => {
        if (alive) setError(failure.message)
      })
    return () => {
      alive = false
    }
  }, [item.path])
  return (
    <div className="sky-link-preview">
      {error ? (
        <p role="alert">{error}</p>
      ) : content === null ? (
        <p>Loading preview…</p>
      ) : (
        <RenderedHtml className="sky-markdown" html={renderStatic(content)} />
      )}
      <a href={href(item.path)} target="_blank" rel="noreferrer">
        Open full record ↗
      </a>
    </div>
  )
}

function Picker({
  opened,
  onClose,
  onPick,
  selected,
  selectedPaths,
  file,
}: {
  opened: boolean
  onClose: () => void
  onPick: (item: LinkItem) => Promise<void>
  selected: string[]
  selectedPaths: string[]
  file?: string
}) {
  const phone = useMediaQuery('(max-width: 900px)') ?? false
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState('')
  const [day, setDay] = useState('')
  const [today, setToday] = useState(PlainDate.today().ymd)
  const [offset, setOffset] = useState(0)
  const [result, setResult] = useState<LinkSearch | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (opened) {
      setQuery('')
      setKind('')
      setDay('')
      setOffset(0)
      setPreview(null)
      setError(null)
    }
  }, [opened])
  useEffect(() => {
    if (!opened) return
    let alive = true
    setResult(null)
    setError(null)
    const timer = window.setTimeout(
      () => {
        const params = new URLSearchParams({ q: query, kind, day, offset: String(offset), exclude: file ?? '' })
        void request<LinkSearch>(`/docs/_api/links?${params}`)
          .then((data) => {
            if (alive) {
              setResult(data)
              setToday(data.today)
            }
          })
          .catch((failure: Error) => {
            if (alive) setError(failure.message)
          })
      },
      query ? 180 : 0,
    )
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [opened, query, kind, day, offset, file])
  const choose = async (item: LinkItem) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await onPick(item)
      onClose()
    } catch (failure) {
      setError((failure as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const move = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>('.sky-link-pick:not(:disabled)') ?? [])]
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next = at + (event.key === 'ArrowDown' ? 1 : -1)
    if (buttons.length) {
      event.preventDefault()
      buttons[Math.max(0, Math.min(next, buttons.length - 1))]?.focus()
    }
  }
  const groups = new Map<string, LinkItem[]>()
  for (const item of result?.items ?? []) {
    const label = query.trim() ? 'Search results' : dateLabel(item.date, today)
    groups.set(label, [...(groups.get(label) ?? []), item])
  }
  const body = (
    <div className="sky-link-picker" aria-busy={busy}>
      <TextInput
        data-autofocus
        aria-label="Search notebook links"
        placeholder="Search by title, person, or topic…"
        value={query}
        onChange={(e) => {
          setQuery(e.currentTarget.value)
          setOffset(0)
        }}
        onKeyDown={move}
      />
      <div className="sky-link-filters">
        <Select
          aria-label="Link type"
          data={KINDS}
          value={kind}
          onChange={(v) => {
            setKind(v ?? '')
            setOffset(0)
          }}
          allowDeselect={false}
        />
        <Select
          aria-label="Link date"
          data={[
            { value: '', label: 'Any date' },
            { value: today, label: 'Today' },
            { value: new PlainDate(today).addDays(-1).ymd, label: 'Yesterday' },
          ]}
          value={day}
          onChange={(v) => {
            setDay(v ?? '')
            setOffset(0)
          }}
          allowDeselect={false}
        />
      </div>
      {error && (
        <p className="sky-rail-problem" role="alert">
          {error}
        </p>
      )}
      <div className="sky-link-results" ref={list} onKeyDown={move} aria-live="polite">
        {!result && !error ? (
          <p>Loading records…</p>
        ) : result?.items.length === 0 ? (
          <p>No matching records. Try another title, person, or date.</p>
        ) : null}
        {[...groups].map(([label, items]) => (
          <section key={label} aria-label={label}>
            <h3>{label}</h3>
            {items.map((item) => {
              const chosen = selected.includes(item.value) || selectedPaths.includes(item.path)
              return (
                <div className="sky-link-result" key={item.path}>
                  <div className="sky-link-result-head">
                    <button
                      className="sky-link-pick"
                      type="button"
                      disabled={chosen || busy}
                      onClick={() => void choose(item)}
                      aria-label={`Link ${item.title}`}
                    >
                      <span className="sky-link-title">
                        {item.title}
                        {chosen ? ' · Linked' : ''}
                      </span>
                      <Detail item={item} />
                    </button>
                    {item.path.endsWith('.md') && (
                      <button
                        type="button"
                        className="sky-link-preview-button"
                        aria-label={`Preview ${item.title}`}
                        aria-expanded={preview === item.path}
                        onClick={() => setPreview(preview === item.path ? null : item.path)}
                      >
                        Preview
                      </button>
                    )}
                  </div>
                  {preview === item.path && <Preview item={item} />}
                </div>
              )
            })}
          </section>
        ))}
      </div>
      <div className="sky-dialog-actions">
        {offset > 0 && (
          <Button size="sm" onClick={() => setOffset(Math.max(0, offset - 40))}>
            Previous
          </Button>
        )}
        {result && offset + result.items.length < result.total && (
          <Button size="sm" onClick={() => setOffset(offset + 40)}>
            More records
          </Button>
        )}
        <Button size="sm" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  )
  return phone ? (
    <Drawer opened={opened} onClose={onClose} title="Add link" position="bottom" size="90dvh">
      {body}
    </Drawer>
  ) : (
    <Modal opened={opened} onClose={onClose} title="Add link" centered size={720}>
      {body}
    </Modal>
  )
}

/** Shared by an import's selections and a saved document's rel property. */
export function LinksInput({
  values,
  onChange,
  readOnly = false,
  file,
}: {
  values: string[]
  onChange?: (values: string[]) => void | Promise<void>
  readOnly?: boolean
  file?: string
}) {
  const [opened, setOpened] = useState(false)
  const [items, setItems] = useState<Record<string, LinkItem>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const key = values.join('\n')
  useEffect(() => {
    if (!values.length) return
    let alive = true
    void request<{ items: LinkItem[] }>('/docs/_api/links/resolve', { values, file })
      .then((data) => {
        if (alive)
          setItems((known) => ({ ...known, ...Object.fromEntries(data.items.map((item) => [item.value, item])) }))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [key, file]) // eslint-disable-line react-hooks/exhaustive-deps -- values is represented by key
  const change = async (next: string[]) => {
    setBusy(true)
    setError(null)
    try {
      await onChange?.(next)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="sky-links-input">
      {values.map((value) => {
        const item = items[value]
        return (
          <div className="sky-linked-row" key={value}>
            <span className="sky-linked-label">
              {item ? (
                <>
                  <LinkIcon kind={item.kind} />
                  <a href={href(item.path)} target="_blank" rel="noreferrer">
                    {item.title}
                  </a>
                </>
              ) : (
                <span>{value}</span>
              )}
            </span>
            {!readOnly && onChange && (
              <button
                type="button"
                disabled={busy}
                className="sky-prop-chip-remove"
                aria-label={`Remove link to ${item?.title ?? value}`}
                onClick={() =>
                  void change(values.filter((v) => v !== value)).catch((failure: Error) => setError(failure.message))
                }
              >
                ×
              </button>
            )}
          </div>
        )
      })}
      {!readOnly && onChange && (
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => setOpened(true)}>
          + Add link
        </Button>
      )}
      {error && (
        <p className="sky-rail-problem" role="alert">
          {error}
        </p>
      )}
      <Picker
        opened={opened}
        onClose={() => setOpened(false)}
        file={file}
        selected={values}
        selectedPaths={values.flatMap((value) => items[value]?.path ?? [])}
        onPick={async (item) => {
          setItems((known) => ({ ...known, [item.value]: item }))
          if (!values.some((value) => value === item.value || items[value]?.path === item.path))
            await change([...values, item.value])
        }}
      />
    </div>
  )
}
