import './links.css'
import { Button, Checkbox, Drawer, Modal, Select, TextInput } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { type LinkItem, type LinkKind, type LinkSearch, PRIMARY_LINK_KINDS } from '../../links/types.ts'
import { LinkTypeFilters, linkTypesHaveDates, linkTypesLabel } from './linkFilters.tsx'
import { LinkIcon } from './linkIcon.tsx'
import { RenderedHtml } from './renderedHtml.tsx'
import { lexInline, plainText } from './wysiwyg/lexer.ts'
import { renderStatic } from './wysiwyg/render.ts'

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

function titleText(title: string): string {
  return plainText(lexInline(title))
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
          From turn {item.parent.turn} of {titleText(item.parent.title)}
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
  onPick: (items: LinkItem[]) => Promise<void>
  selected: string[]
  selectedPaths: string[]
  file?: string
}) {
  const phone = useMediaQuery('(max-width: 900px)') ?? false
  const [query, setQuery] = useState('')
  const [kinds, setKinds] = useState<LinkKind[]>([])
  const [filtersOpened, setFiltersOpened] = useState(false)
  const [datesOpened, setDatesOpened] = useState(false)
  const [day, setDay] = useState('')
  const [today, setToday] = useState(PlainDate.today().ymd)
  const [offset, setOffset] = useState(0)
  const [result, setResult] = useState<LinkSearch | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<LinkItem[]>([])
  const [preview, setPreview] = useState<string | null>(null)
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (opened) {
      setQuery('')
      setKinds([])
      setFiltersOpened(false)
      setDatesOpened(false)
      setDay('')
      setOffset(0)
      setPreview(null)
      setError(null)
      setPending([])
    }
  }, [opened])
  useEffect(() => {
    if (!opened) return
    let alive = true
    setResult(null)
    setError(null)
    const timer = window.setTimeout(
      () => {
        const params = new URLSearchParams({ q: query, day, offset: String(offset), exclude: file ?? '' })
        for (const kind of kinds) params.append('kind', kind)
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
  }, [opened, query, kinds, day, offset, file])
  const changeKinds = (next: LinkKind[]) => {
    setKinds(next)
    if (!linkTypesHaveDates(next)) setDay('')
    setOffset(0)
    setPreview(null)
  }
  const choose = async () => {
    if (busy || !pending.length) return
    setBusy(true)
    setError(null)
    try {
      const choices: LinkItem[] = []
      for (const item of pending) {
        choices.push(
          item.needsCreation
            ? (await request<{ item: LinkItem }>('/docs/_api/links/choose', { value: item.value })).item
            : item,
        )
      }
      await onPick(choices)
      onClose()
    } catch (failure) {
      setError((failure as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const close = () => {
    if (!busy) onClose()
  }
  const move = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement && event.target.type === 'checkbox') {
      event.preventDefault()
      event.target.click()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const inputs = [...(list.current?.querySelectorAll<HTMLInputElement>('.sky-link-pick input:not(:disabled)') ?? [])]
    const at = inputs.indexOf(document.activeElement as HTMLInputElement)
    const next = at + (event.key === 'ArrowDown' ? 1 : -1)
    if (inputs.length) {
      event.preventDefault()
      inputs[Math.max(0, Math.min(next, inputs.length - 1))]?.focus()
    }
  }
  const groups = new Map<string, LinkItem[]>()
  const primaryOnly = kinds.length > 0 && kinds.every((kind) => PRIMARY_LINK_KINDS.includes(kind))
  const typesLabel = linkTypesLabel(kinds)
  for (const item of result?.items ?? []) {
    const label = query.trim()
      ? 'Search results'
      : item.frequent
        ? 'Frequently linked'
        : PRIMARY_LINK_KINDS.includes(item.kind)
          ? primaryOnly
            ? 'More records'
            : 'Elsewhere in the notebook'
          : dateLabel(item.date, today)
    groups.set(label, [...(groups.get(label) ?? []), item])
  }
  const body = (
    <div
      className="sky-link-picker"
      aria-busy={busy || (!result && !error)}
      onKeyDown={(event) => {
        // Escape belongs to this picker or its popover, not the enclosing Details rail.
        if (event.key === 'Escape') event.stopPropagation()
      }}
    >
      <TextInput
        data-autofocus
        aria-label="Search notebook links"
        placeholder="Search people, orgs, projects, or records…"
        value={query}
        onChange={(e) => {
          setQuery(e.currentTarget.value)
          setOffset(0)
        }}
        onKeyDown={move}
      />
      <div className="sky-link-browse" data-phone={phone || undefined}>
        <LinkTypeFilters
          kinds={kinds}
          onChange={changeKinds}
          phone={phone}
          disabled={busy}
          popoverOpened={filtersOpened}
          onPopoverChange={setFiltersOpened}
        />
        <div className="sky-link-results-column">
          <div className="sky-link-results-heading">
            <h2 title={typesLabel}>{kinds.length > 3 ? `${kinds.length} types` : typesLabel}</h2>
            {linkTypesHaveDates(kinds) && (
              <Select
                aria-label="Link date"
                className="sky-link-date-filter"
                classNames={{ dropdown: 'sky-link-date-dropdown' }}
                variant="unstyled"
                size="sm"
                onDropdownOpen={() => setDatesOpened(true)}
                onDropdownClose={() => setDatesOpened(false)}
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
                disabled={busy}
              />
            )}
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
                  const checked = pending.some((choice) => choice.path === item.path)
                  const title = titleText(item.title)
                  return (
                    <div className="sky-link-result" key={item.path}>
                      <div className="sky-link-result-head">
                        <Checkbox
                          className="sky-link-pick"
                          color="var(--sky-action-primary)"
                          iconColor="var(--sky-action-primary-text)"
                          classNames={{ body: 'sky-link-choice', label: 'sky-link-label' }}
                          wrapperProps={{ 'data-selected': checked || undefined, 'data-linked': chosen || undefined }}
                          checked={chosen || checked}
                          disabled={chosen || busy}
                          onChange={() =>
                            setPending((choices) =>
                              choices.some((choice) => choice.path === item.path)
                                ? choices.filter((choice) => choice.path !== item.path)
                                : [...choices, item],
                            )
                          }
                          aria-label={`${chosen ? 'Linked' : 'Select'} ${title}`}
                          label={
                            <>
                              <span className="sky-link-title">
                                {title}
                                {chosen ? ' · Linked' : ''}
                              </span>
                              <Detail item={item} />
                            </>
                          }
                        />
                        {!item.needsCreation && item.path.endsWith('.md') && (
                          <button
                            type="button"
                            className="sky-link-preview-button"
                            aria-label={`Preview ${title}`}
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
        </div>
      </div>
      <div className="sky-link-footer">
        <div className="sky-link-pagination">
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
        </div>
        <div className="sky-dialog-actions sky-link-actions">
          <Button size="sm" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" onClick={() => void choose()} disabled={!pending.length} loading={busy}>
            Add {pending.length} {pending.length === 1 ? 'link' : 'links'}
          </Button>
        </div>
      </div>
    </div>
  )
  return phone ? (
    <Drawer
      opened={opened}
      onClose={close}
      title="Add links"
      position="bottom"
      size="90dvh"
      classNames={{ content: 'sky-link-dialog-content', body: 'sky-link-dialog-body' }}
      closeButtonProps={{ disabled: busy }}
      closeOnEscape={!filtersOpened && !datesOpened}
    >
      {body}
    </Drawer>
  ) : (
    <Modal
      opened={opened}
      onClose={close}
      title="Add links"
      centered
      size={820}
      classNames={{ content: 'sky-link-dialog-content', body: 'sky-link-dialog-body' }}
      closeButtonProps={{ disabled: busy }}
      closeOnEscape={!filtersOpened && !datesOpened}
    >
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
                    {titleText(item.title)}
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
                aria-label={`Remove link to ${item ? titleText(item.title) : value}`}
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
        onPick={async (choices) => {
          setItems((known) => ({ ...known, ...Object.fromEntries(choices.map((item) => [item.value, item])) }))
          const additions = choices.filter(
            (item) => !values.some((value) => value === item.value || items[value]?.path === item.path),
          )
          if (additions.length) await change([...values, ...additions.map((item) => item.value)])
        }}
      />
    </div>
  )
}
