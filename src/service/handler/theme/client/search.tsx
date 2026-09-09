import { ActionIcon, Button, Menu } from '@mantine/core'
import { useFocusTrap, useMediaQuery, useMergedRef } from '@mantine/hooks'
import { Fragment, type KeyboardEvent, type MouseEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import type { LinkKind } from '../../links/types.ts'
import {
  SEARCH_KINDS,
  type SearchFilter,
  type SearchKind,
  type SearchResponse,
  type SearchResult,
} from '../../search/types.ts'
import type { Backlink } from '../../vocabulary/mod.ts'
import { type ExplorerDoc, fileHref } from './explorer.tsx'
import { LinkIcon } from './linkIcon.tsx'
import { RenderedHtml } from './renderedHtml.tsx'

const LABELS: Record<SearchKind, string> = {
  person: 'Person',
  org: 'Organization',
  place: 'Place',
  day: 'Day',
  project: 'Project',
  meeting: 'Meeting',
  video: 'Video',
  chat: 'Chat',
  message: 'Message',
  journal: 'Journal',
  note: 'Note',
  library: 'Library',
  goal: 'Goal',
  decision: 'Decision',
  idea: 'Idea',
  streak: 'Streak',
  tracking: 'Tracking',
}
const FILTERS = [
  ['all', 'All'],
  ['person', 'People'],
  ['org', 'Organizations'],
  ['place', 'Places'],
  ['day', 'Days'],
] as const
const OTHER_KINDS = SEARCH_KINDS.filter((kind) => !FILTERS.some(([filter]) => filter === kind))
const EXTRA_ICONS = new Set<SearchKind>(['goal', 'decision', 'idea', 'streak', 'tracking'])
const resultCount = (count: number) => `${count} ${count === 1 ? 'result' : 'results'}`

function Glyph({ name }: { name: 'search' | 'close' | 'arrow' | 'back' | 'enter' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === 'search' ? (
        <>
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="m16 16 4.5 4.5" />
        </>
      ) : (
        <path
          d={
            name === 'close'
              ? 'm6 6 12 12M18 6 6 18'
              : name === 'enter'
                ? 'M19 5v8H5m5-5-5 5 5 5'
                : name === 'back'
                  ? 'M19 12H5m5-5-5 5 5 5'
                  : 'M5 12h14m-5-5 5 5-5 5'
          }
        />
      )}
    </svg>
  )
}

function KindIcon({ kind }: { kind: SearchKind }) {
  return (
    <span className="sky-search-kind-icon" data-kind={kind} aria-hidden="true">
      <LinkIcon kind={EXTRA_ICONS.has(kind) ? 'note' : (kind as LinkKind)} />
    </span>
  )
}

function Highlight({ text, query }: { text: string; query: string }) {
  const at = text.toLowerCase().indexOf(query.trim().toLowerCase())
  const length = query.trim().length
  return at < 0 || !length ? (
    <>{text}</>
  ) : (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + length)}</mark>
      {text.slice(at + length)}
    </>
  )
}

function SearchFilters({ value, onChange }: { value: SearchFilter; onChange: (kind: SearchFilter) => void }) {
  const more = !FILTERS.some(([kind]) => kind === value)
  return (
    <div className="sky-search-filters" role="group" aria-label="Filter search results">
      {FILTERS.map(([kind, label]) => (
        <button type="button" key={kind} aria-pressed={value === kind} onClick={() => onChange(kind)}>
          {label}
        </button>
      ))}
      <Menu position="bottom-end" withinPortal>
        <Menu.Target>
          <button type="button" aria-pressed={more}>
            {more && value !== 'more' ? LABELS[value as SearchKind] : 'More'} <span aria-hidden="true">⌄</span>
          </button>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item onClick={() => onChange('more')}>All other types</Menu.Item>
          <Menu.Divider />
          {OTHER_KINDS.map((kind) => (
            <Menu.Item key={kind} onClick={() => onChange(kind)}>
              {LABELS[kind]}
            </Menu.Item>
          ))}
        </Menu.Dropdown>
      </Menu>
    </div>
  )
}

function routeValues(route: string) {
  const params = new URLSearchParams(route.split('?')[1] ?? '')
  const raw = params.get('kind') ?? 'all'
  const kind: SearchFilter = raw === 'more' || SEARCH_KINDS.includes(raw as SearchKind) ? (raw as SearchFilter) : 'all'
  const offset = Number(params.get('offset') ?? 0)
  return {
    query: params.get('q') ?? '',
    kind,
    sort: params.get('sort') === 'newest' ? 'newest' : 'relevance',
    offset: Number.isFinite(offset) ? Math.max(0, Math.trunc(offset)) : 0,
  }
}

function useSearch(query: string, kind: SearchFilter, sort: string, offset: number, full: boolean, enabled: boolean) {
  const params = new URLSearchParams({ q: query, kind, sort, offset: String(offset), limit: full ? '40' : '8' })
  const key = params.toString()
  const [retry, setRetry] = useState(0)
  const [response, setResponse] = useState<{ key: string; data?: SearchResponse; error?: string; loading: boolean }>({
    key: '',
    loading: false,
  })
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    setResponse({ key, loading: true })
    const timeout = window.setTimeout(() => {
      void fetch(`/search/_api?${key}`, { signal: controller.signal })
        .then(async (response) => {
          const data = (await response.json()) as SearchResponse & { message?: string }
          if (!response.ok) throw new Error(data.message ?? 'Search could not load. Try again.')
          if (!controller.signal.aborted) setResponse({ key, data, loading: false })
        })
        .catch((error: Error) => {
          if (!controller.signal.aborted) setResponse({ key, error: error.message, loading: false })
        })
    }, 160)
    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [key, enabled, retry])
  return {
    data: response.key === key ? response.data : undefined,
    error: response.key === key ? response.error : undefined,
    loading: response.key !== key || response.loading,
    retry: () => setRetry((value) => value + 1),
  }
}

function RowContent({ item, query, full }: { item: SearchResult; query: string; full?: boolean }) {
  return (
    <>
      <KindIcon kind={item.kind} />
      <span className="sky-search-row-copy">
        {full && (
          <span className="sky-search-row-type">{[LABELS[item.kind], item.date].filter(Boolean).join(' · ')}</span>
        )}
        <span className="sky-search-row-title">
          <Highlight text={item.title} query={query} />
        </span>
        <span className="sky-search-row-sub">
          <Highlight text={item.subtitle || item.snippet || item.date || LABELS[item.kind]} query={query} />
        </span>
      </span>
      {!full && (
        <>
          <span className="sky-search-row-kind">{LABELS[item.kind]}</span>
          <span className="sky-search-row-enter">
            <Glyph name="enter" />
          </span>
        </>
      )}
    </>
  )
}

function Preview({
  item,
  onOpen,
  onClose,
}: {
  item: SearchResult
  onOpen: (item: SearchResult) => void
  onClose: () => void
}) {
  const [view, setView] = useState<{
    path: string
    doc?: ExplorerDoc
    backlinks?: Backlink[]
    error?: string
    linksError?: boolean
  }>({ path: '' })
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setView({ path: item.relativePath })
    if (item.relativePath) {
      const read = async <T,>(url: string): Promise<T> => {
        const response = await fetch(url, { signal: controller.signal })
        if (!response.ok)
          throw new Error(
            response.status === 404 ? 'This record is no longer available.' : 'The preview could not load. Try again.',
          )
        return response.json() as Promise<T>
      }
      void Promise.allSettled([
        read<ExplorerDoc>(`/explorer/_api/doc?path=${encodeURIComponent(item.relativePath)}`),
        read<{ items: Backlink[] }>(`/docs/_api/backlinks?path=${encodeURIComponent(item.relativePath)}&limit=6`),
      ]).then(([doc, links]) => {
        if (controller.signal.aborted) return
        setView({
          path: item.relativePath,
          doc: doc.status === 'fulfilled' ? doc.value : undefined,
          error: doc.status === 'rejected' ? String(doc.reason?.message ?? 'Preview unavailable.') : undefined,
          backlinks: links.status === 'fulfilled' ? links.value.items : [],
          linksError: links.status === 'rejected',
        })
      })
    }
    return () => controller.abort()
  }, [item.relativePath, retry])
  const current = view.path === item.relativePath ? view : undefined
  const clickLink = (event: MouseEvent) => {
    const anchor = (event.target as Element).closest('a')
    const href = anchor?.getAttribute('href')
    if (
      !href ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      /^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(href)
    )
      return
    if (!/\.md(?:#.*)?$/i.test(href)) return
    event.preventDefault()
    const destination = new URL(href, `${location.origin}${fileHref(item.relativePath)}`)
    onOpen({ ...item, href: destination.pathname })
  }
  return (
    <aside className="sky-search-preview" aria-label="Result preview">
      <div className="sky-search-preview-scroll" onClick={clickLink}>
        <div className="sky-search-preview-label">
          <span>{LABELS[item.kind]} preview</span>
          <ActionIcon aria-label="Close preview" size="sm" onClick={onClose}>
            <Glyph name="close" />
          </ActionIcon>
        </div>
        <div className="sky-search-preview-hero">
          <KindIcon kind={item.kind} />
          <div>
            <h2>{item.title}</h2>
            {item.date && <span>{item.date}</span>}
          </div>
        </div>
        {item.properties.length > 0 && (
          <dl>
            {item.properties.map(({ label, value }, index) => (
              <Fragment key={`${label}-${index}`}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </Fragment>
            ))}
          </dl>
        )}
        <section className="sky-search-preview-section">
          {current?.error ? (
            <>
              <p role="alert">{current.error}</p>
              <Button onClick={() => setRetry((value) => value + 1)}>Retry preview</Button>
            </>
          ) : current?.doc ? (
            <RenderedHtml
              className="sky-markdown sky-search-preview-prose"
              html={current.doc.html || '<p>No notes yet.</p>'}
            />
          ) : (
            <p>
              {item.relativePath ? 'Loading preview…' : 'No day file yet. Open the day to see its plan and activity.'}
            </p>
          )}
        </section>
        {current?.backlinks?.length || current?.linksError ? (
          <section className="sky-search-preview-section">
            <h3>Linked from</h3>
            {current.linksError ? (
              <p>Related records could not load.</p>
            ) : (
              current.backlinks?.map((link) => (
                <a key={link.path} href={fileHref(link.path)} className="sky-search-related">
                  <span>
                    {link.label}
                    <small>{link.date}</small>
                  </span>
                  <Glyph name="arrow" />
                </a>
              ))
            )}
          </section>
        ) : null}
      </div>
      <div className="sky-search-preview-foot">
        <Button variant="primary" fullWidth rightSection={<Glyph name="arrow" />} onClick={() => onOpen(item)}>
          Open {item.kind === 'person' ? item.title : LABELS[item.kind].toLowerCase()}
        </Button>
      </div>
    </aside>
  )
}

/** The header owns search; the page and its own rail stay mounted under quick results. */
export function SearchWorkspace({
  route,
  onNavigate,
  children,
}: {
  route: string
  onNavigate: (href: string) => void
  children: ReactNode
}) {
  const full = route.split('?')[0] === '/search'
  const initial = routeValues(route)
  const [query, setQuery] = useState(full ? initial.query : '')
  const [kind, setKind] = useState<SearchFilter>(full ? initial.kind : 'all')
  const [sort, setSort] = useState(full ? initial.sort : 'relevance')
  const [opened, setOpened] = useState(false)
  const [selected, setSelected] = useState(0)
  const [previewPath, setPreviewPath] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(true)
  const [mobilePreview, setMobilePreview] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const anchor = useRef<HTMLDivElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const phone = useMediaQuery('(max-width: 650px)')
  const trap = useFocusTrap(!!phone && opened)
  const anchorRef = useMergedRef(anchor, trap)
  const offset = initial.offset
  const request = useSearch(query, kind, sort, 0, false, opened)
  const pageRequest = useSearch(initial.query, initial.kind, initial.sort, offset, true, full)
  const pageData = pageRequest.data
  const pageDateMode = !!pageData?.day && (initial.kind === 'all' || initial.kind === 'day')
  const data = request.data
  const dateMode = !!data?.day && (kind === 'all' || kind === 'day')
  const options = dateMode ? [data!.day!, ...data!.dayItems] : (data?.results.slice(0, 7) ?? [])
  const active = Math.min(selected, Math.max(0, options.length - 1))
  const preview =
    pageData?.results.find((item) => item.relativePath === previewPath) ??
    pageData?.results[0] ??
    (pageDateMode ? pageData?.day : undefined)

  useEffect(() => {
    setOpened(false)
    setMobilePreview(false)
    if (route.split('?')[0] === '/search') {
      const values = routeValues(route)
      setQuery(values.query)
      setKind(values.kind)
      setSort(values.sort)
    }
  }, [route])
  const close = (restore = false) => {
    setOpened(false)
    if (full) {
      setQuery(initial.query)
      setKind(initial.kind)
      setSort(initial.sort)
    }
    if (restore) previousFocus.current?.focus()
    else input.current?.blur()
  }
  useEffect(() => {
    const shortcut = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        if (document.querySelector('[role="dialog"]')) return
        event.preventDefault()
        if (document.activeElement !== input.current)
          previousFocus.current = document.activeElement as HTMLElement | null
        setOpened(true)
        input.current?.focus()
        input.current?.select()
      }
      if (event.key === 'Escape' && !event.defaultPrevented && opened) {
        if (document.querySelector('.mantine-Menu-dropdown')) return
        event.preventDefault()
        event.stopPropagation()
        close(true)
      }
    }
    window.addEventListener('keydown', shortcut, true)
    return () => window.removeEventListener('keydown', shortcut, true)
  }, [opened, route])
  useEffect(() => {
    if (!opened) return
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('.mantine-Menu-dropdown')) return
      if (!anchor.current?.contains(event.target as Node)) close()
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [opened, route])
  useEffect(() => {
    setSelected(0)
  }, [query, kind])
  useEffect(() => {
    if (opened) document.getElementById(`sky-search-option-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [active, opened])

  const open = (item: SearchResult) => {
    setOpened(false)
    input.current?.blur()
    setQuery('')
    onNavigate(item.href)
  }
  const browse = (changes: { kind?: SearchFilter; sort?: string; offset?: number; query?: string } = {}) => {
    const params = new URLSearchParams({ q: changes.query ?? query, kind: changes.kind ?? kind })
    if ((changes.sort ?? sort) === 'newest') params.set('sort', 'newest')
    if (changes.offset) params.set('offset', String(changes.offset))
    setOpened(false)
    input.current?.blur()
    onNavigate(`/search?${params}`)
  }
  const changeKind = (value: SearchFilter) => {
    setKind(value)
    setMobilePreview(false)
    if (full && !opened) browse({ kind: value })
  }
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setOpened(true)
      if (options.length) setSelected((active + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (!event.metaKey && !event.ctrlKey && opened && options[active] && !request.loading) open(options[active]!)
      else browse()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      close(true)
    }
  }
  const statusFor = (request: ReturnType<typeof useSearch>) =>
    request.error ? (
      <div className="sky-search-empty" role="alert">
        <p>{request.error}</p>
        <Button onClick={request.retry}>Try again</Button>
      </div>
    ) : request.loading ? (
      <div className="sky-search-empty" role="status">
        Searching your notebook…
      </div>
    ) : null
  const emptyFor = (query: string, kind: SearchFilter) => (
    <div className="sky-search-empty">
      <Glyph name="search" />
      <h2>{query.trim() ? `No matches for “${query}”` : 'Your notebook is ready to search'}</h2>
      <p>
        {kind === 'all'
          ? 'Try a name, title, date, or words you remember.'
          : 'Try another type, or search across your whole notebook.'}
      </p>
      {kind !== 'all' && <Button onClick={() => changeKind('all')}>Search all types</Button>}
    </div>
  )
  const status = statusFor(request)
  const empty = emptyFor(query, kind)

  return (
    <div className="sky-workspace" data-search-open={opened || undefined}>
      <header className="sky-global-header">
        <div
          className="sky-search-anchor"
          ref={anchorRef}
          onBlur={(event) => {
            if (
              event.relatedTarget &&
              !event.currentTarget.contains(event.relatedTarget as Node) &&
              !(event.relatedTarget as Element).closest?.('.mantine-Menu-dropdown')
            )
              close()
          }}
        >
          <div className="sky-search-field" data-open={opened || undefined}>
            <Glyph name="search" />
            <input
              ref={input}
              type="text"
              role="combobox"
              aria-label="Search anything"
              aria-autocomplete="list"
              aria-expanded={opened}
              aria-controls={opened ? 'sky-search-options' : undefined}
              aria-activedescendant={opened && options.length ? `sky-search-option-${active}` : undefined}
              placeholder="Search anything…"
              autoComplete="off"
              maxLength={500}
              value={query}
              onFocus={() => setOpened(true)}
              onKeyDown={keyDown}
              onChange={(event) => {
                setQuery(event.target.value)
                setOpened(true)
              }}
            />
            {query && (
              <ActionIcon
                aria-label="Clear search"
                size="sm"
                onClick={() => {
                  setQuery('')
                  setSelected(0)
                  input.current?.focus()
                }}
              >
                <Glyph name="close" />
              </ActionIcon>
            )}
            <kbd className="sky-search-shortcut">{opened ? 'esc' : '⌘ K'}</kbd>
            {opened && (
              <Button className="sky-search-cancel" size="compact-sm" variant="primary-quiet" onClick={() => close()}>
                Cancel
              </Button>
            )}
          </div>
          {opened && (
            <section className="sky-search-popover" aria-label="Quick search results">
              {!dateMode && <SearchFilters value={kind} onChange={changeKind} />}
              <div className="sky-search-quick-scroll">
                {status ?? (
                  <>
                    {!query.trim() && (
                      <div className="sky-search-intro">
                        <h2>Your notebook, one search away.</h2>
                        <p>People, places, organizations, days, and everything you’ve written.</p>
                        <div>
                          {['today', 'yesterday'].map((value) => (
                            <Button
                              key={value}
                              size="compact-sm"
                              onClick={() => {
                                setKind('all')
                                setQuery(value)
                              }}
                            >
                              {value === 'today' ? 'Today' : 'Yesterday'}
                            </Button>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="sky-search-group">
                      {dateMode
                        ? `Go to a day · ${data?.day?.date}`
                        : query.trim()
                          ? 'Best matches'
                          : 'Recent in your notebook'}
                      <span>{!dateMode && data?.total ? resultCount(data.total) : ''}</span>
                    </div>
                    <div id="sky-search-options" role="listbox" aria-label="Matching notebook items">
                      {options.map((item, index) => (
                        <Fragment key={item.href}>
                          {dateMode && index === 1 && <div className="sky-search-group">On this day</div>}
                          <div
                            id={`sky-search-option-${index}`}
                            role="option"
                            aria-selected={active === index}
                            className="sky-search-row"
                            data-day={(dateMode && index === 0) || undefined}
                            onMouseMove={() => setSelected(index)}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => open(item)}
                          >
                            <RowContent item={item} query={query} />
                          </div>
                        </Fragment>
                      ))}
                    </div>
                    {!options.length && empty}
                  </>
                )}
              </div>
              <footer className="sky-search-footer">
                <span>
                  <kbd>↑</kbd> <kbd>↓</kbd> to move <kbd>↵</kbd> to open <kbd>esc</kbd> to close
                </span>
                <Button
                  size="compact-sm"
                  variant="primary-quiet"
                  rightSection={<Glyph name="arrow" />}
                  onClick={() => browse()}
                >
                  {dateMode
                    ? 'Everything from this day'
                    : data
                      ? `View all ${resultCount(data.total)}`
                      : 'View all results'}
                </Button>
              </footer>
            </section>
          )}
        </div>
      </header>
      <div className="sky-workspace-page" inert={(opened && phone) || undefined}>
        {full ? (
          <main className="sky-search-page">
            <div className="sky-search-heading">
              <div>
                <h1>{initial.query.trim() ? `Results for “${initial.query}”` : 'Search your notebook'}</h1>
                <p role="status">
                  {pageData
                    ? `${resultCount(pageData.total)} across your notebook`
                    : 'Search names, dates, titles, and document text.'}
                </p>
              </div>
              <Menu withinPortal>
                <Menu.Target>
                  <Button size="compact-sm">{initial.sort === 'newest' ? 'Newest first' : 'Most relevant'} ⌄</Button>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item onClick={() => browse({ sort: 'relevance' })}>Most relevant</Menu.Item>
                  <Menu.Item onClick={() => browse({ sort: 'newest' })}>Newest first</Menu.Item>
                </Menu.Dropdown>
              </Menu>
            </div>
            <SearchFilters value={initial.kind} onChange={changeKind} />
            {statusFor(pageRequest) ??
              (pageData && (pageData.results.length || pageDateMode) ? (
                <div
                  className="sky-search-results"
                  data-preview={previewOpen || undefined}
                  data-mobile-preview={mobilePreview || undefined}
                >
                  <div className="sky-search-list">
                    <div aria-label="Search results">
                      {(pageData.results.length ? pageData.results : pageData.day ? [pageData.day] : []).map((item) => (
                        <button
                          type="button"
                          key={item.href}
                          className="sky-search-row"
                          aria-pressed={preview?.href === item.href && previewOpen}
                          onClick={() => {
                            setPreviewPath(item.relativePath)
                            setPreviewOpen(true)
                            setMobilePreview(true)
                          }}
                          onDoubleClick={() => open(item)}
                        >
                          <RowContent item={item} query={initial.query} full />
                        </button>
                      ))}
                    </div>
                    {pageData.total > 40 && (
                      <div className="sky-search-pagination">
                        <Button
                          size="compact-sm"
                          disabled={offset === 0}
                          onClick={() => browse({ offset: Math.max(0, offset - 40) })}
                        >
                          Previous
                        </Button>
                        <span>
                          {offset + 1}–{Math.min(offset + 40, pageData.total)} of {pageData.total}
                        </span>
                        <Button
                          size="compact-sm"
                          disabled={offset + 40 >= pageData.total}
                          onClick={() => browse({ offset: offset + 40 })}
                        >
                          Next
                        </Button>
                      </div>
                    )}
                  </div>
                  {preview && previewOpen && (
                    <Preview
                      item={preview}
                      onOpen={open}
                      onClose={() => {
                        setMobilePreview(false)
                        if (!phone) setPreviewOpen(false)
                      }}
                    />
                  )}
                </div>
              ) : (
                emptyFor(initial.query, initial.kind)
              ))}
          </main>
        ) : (
          children
        )}
      </div>
      {opened && <div className="sky-search-scrim" onClick={() => close()} />}
    </div>
  )
}
