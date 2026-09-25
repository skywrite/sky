import './places.css'
import { Button, Checkbox, Modal, Select, Textarea, TextInput } from '@mantine/core'
import { useCallback, useEffect, useState } from 'react'
import {
  isWithinPlace,
  placeCategories,
  placeHref,
  placeKinds,
  type Coordinates,
  type MapsConfig,
  type PlaceDetail,
  type PlacesIndex,
} from '../../places/types.ts'
import { placesApi } from './placesApi.ts'
import { PlaceRow, PlacesDetail } from './placesDetail.tsx'
import { PlacesEditor } from './placesEditor.tsx'
import { PlaceIcon } from './placesIcons.tsx'
import { PlacesMap } from './placesMap.tsx'
import { PlacesSetup } from './placesSetup.tsx'

export function placesRouteOf(path: string): string | null {
  if (path === '/places' || path === '/places/') return ''
  if (!path.startsWith('/places/')) return null
  try {
    return `places/${decodeURIComponent(path.slice('/places/'.length))}`
  } catch {
    return `places/${path.slice('/places/'.length)}`
  }
}
export function PlacesMain({ route, navigate }: { route: string; navigate: (href: string) => void }) {
  const [index, setIndex] = useState<PlacesIndex | null>(null),
    [detail, setDetail] = useState<PlaceDetail | null>(null),
    [error, setError] = useState('')
  const [query, setQuery] = useState(''),
    [tab, setTab] = useState('all'),
    [area, setArea] = useState<string | null>(null),
    [category, setCategory] = useState<string | null>(null)
  const [view, setView] = useState<'map' | 'list'>(() =>
    localStorage.getItem('sky-places-view') === 'list' ? 'list' : 'map',
  )
  const [selected, setSelected] = useState<string | null>(null),
    [archived, setArchived] = useState(false)
  const [editor, setEditor] = useState<{ initial?: PlaceDetail; coordinates?: Coordinates; manual?: boolean } | null>(
    null,
  )
  const [setup, setSetup] = useState(false),
    [noteOpen, setNoteOpen] = useState(false),
    [note, setNote] = useState(''),
    [noteError, setNoteError] = useState('')
  const [saving, setSaving] = useState(false),
    [archiveOpen, setArchiveOpen] = useState(false),
    [archiveError, setArchiveError] = useState('')
  const [notice, setNotice] = useState(''),
    [lastArchived, setLastArchived] = useState<PlaceDetail | null>(null)
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), notice === 'Place archived.' ? 10_000 : 5_000)
    return () => clearTimeout(timer)
  }, [notice])
  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const [next, place] = await Promise.all([
          placesApi<PlacesIndex>('', undefined, signal),
          route
            ? placesApi<PlaceDetail>(`/place?ref=${encodeURIComponent(route)}`, undefined, signal)
            : Promise.resolve(null),
        ])
        if (signal?.aborted) return
        setIndex(next)
        setDetail(place)
        setError('')
      } catch (error) {
        if (!signal?.aborted) setError((error as Error).message)
      }
    },
    [route],
  )
  useEffect(() => {
    const abort = new AbortController()
    setDetail(null)
    void load(abort.signal)
    return () => abort.abort()
  }, [load])
  useEffect(() => {
    document.title = `sky · ${detail?.name || 'Places'}`
  }, [detail?.name])
  useEffect(() => {
    if (editor || noteOpen || archiveOpen || setup) return
    const abort = new AbortController(),
      refresh = () => {
        if (!document.hidden) void load(abort.signal)
      }
    const timer = setInterval(refresh, 30_000)
    window.addEventListener('focus', refresh)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', refresh)
      abort.abort()
    }
  }, [load, editor, noteOpen, archiveOpen, setup])
  const saved = (place: PlaceDetail) => {
    setEditor(null)
    setDetail(place)
    setNotice('Place saved.')
    setIndex((old) => (old ? { ...old, places: [...old.places.filter((p) => p.id !== place.id), place] } : old))
    navigate(placeHref(place.ref))
  }
  const all = index?.places ?? [],
    available = all.filter((place) => (archived ? place.archived : !place.archived))
  const filtered = available
    .filter((place) => {
      if ((tab === 'venues' && place.kind !== 'venue') || (tab === 'areas' && place.kind === 'venue')) return false
      if (category && (place.kind === 'venue' ? place.category : place.kind) !== category) return false
      if (area && place.ref !== area && !isWithinPlace(place, area, all)) return false
      return (
        !query.trim() ||
        [place.name, ...place.aliases, place.address, place.locationLabel]
          .join(' ')
          .toLowerCase()
          .includes(query.trim().toLowerCase())
      )
    })
    .sort((a, b) => a.name.localeCompare(b.name))
  const venues = filtered.filter((place) => place.kind === 'venue'),
    areas = filtered.filter((place) => place.kind !== 'venue')
  const showCount = (kind: string) =>
    kind === 'all'
      ? available.length
      : available.filter((place) => (kind === 'venues' ? place.kind === 'venue' : place.kind !== 'venue')).length
  const maps: MapsConfig = index?.maps ?? { browserKey: '', mapId: '', searchAvailable: false, configurable: false }
  const clear = () => {
    setQuery('')
    setArea(null)
    setCategory(null)
    setTab('all')
    setSelected(null)
  }
  const empty = index && !available.length && !archived
  const rows = (places: typeof all) =>
    places.map((place) => (
      <PlaceRow
        key={place.id}
        place={place}
        navigate={navigate}
        selected={selected === place.ref}
        full={view === 'list'}
        onSelect={
          view === 'map' && place.coordinates
            ? () => {
                setSelected(selected === place.ref ? null : place.ref)
                if (window.matchMedia('(max-width: 680px)').matches)
                  document
                    .querySelector('.sky-places-map-region')
                    ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
              }
            : undefined
        }
      />
    ))
  return (
    <>
      <main className={`sky-main sky-places-page ${route ? 'sky-places-detail' : ''}`}>
        {error && (
          <div className="sky-places-error-panel" role="alert">
            <p>{error}</p>
            <Button onClick={() => void load()}>Try again</Button>
            {route && <Button onClick={() => navigate('/places')}>Back to Places</Button>}
          </div>
        )}
        {!index && !error && <p role="status">Loading your places…</p>}
        {route ? (
          detail && (
            <PlacesDetail
              key={detail.ref}
              place={detail}
              maps={maps}
              navigate={navigate}
              onEdit={() => setEditor({ initial: detail })}
              onNote={() => {
                setNote('')
                setNoteError('')
                setNoteOpen(true)
              }}
              onArchive={() => {
                setArchiveError('')
                setArchiveOpen(true)
              }}
              onSetup={() => setSetup(true)}
            />
          )
        ) : (
          <>
            <header className="sky-places-header">
              <div>
                <h1>Places</h1>
                <p>Your places, from a favorite café to a whole city.</p>
              </div>
              <Button
                variant="primary"
                leftSection={<PlaceIcon name="plus" />}
                onClick={() => setEditor({})}
                disabled={!index}
              >
                Add place
              </Button>
            </header>
            {empty ? (
              <div className="sky-places-empty">
                <span className="sky-places-empty-art">
                  <PlaceIcon name="map" size={100} />
                  <PlaceIcon name="pin" size={44} />
                </span>
                <h2>A place for your places</h2>
                <p>
                  Save somewhere you love, somewhere you work,
                  <br />
                  or somewhere you’re going next.
                </p>
                <div>
                  <Button variant="primary" onClick={() => setEditor({})}>
                    Add your first place
                  </Button>
                  <Button variant="primary-quiet" onClick={() => setEditor({ manual: true })}>
                    Add manually
                  </Button>
                </div>
                <small>Venues, cities, and whole countries. Start with a name.</small>
                {all.some((p) => p.archived) && (
                  <Button variant="subtle" onClick={() => setArchived(true)}>
                    View archived places
                  </Button>
                )}
              </div>
            ) : (
              index && (
                <>
                  <div className="sky-places-navigation">
                    <nav className="sky-places-tabs" aria-label="Place kinds">
                      {[
                        ['all', 'All places'],
                        ['venues', 'Venues'],
                        ['areas', 'Cities & areas'],
                      ].map(([kind, label]) => (
                        <button
                          key={kind}
                          className={tab === kind ? 'active' : ''}
                          onClick={() => {
                            setTab(kind)
                            setSelected(null)
                          }}
                        >
                          {label}
                          <span className="sky-places-count">{showCount(kind)}</span>
                        </button>
                      ))}
                    </nav>
                    <div className="sky-places-view-toggle" role="group" aria-label="Place view">
                      {(['map', 'list'] as const).map((mode) => (
                        <button
                          key={mode}
                          aria-pressed={view === mode}
                          className={view === mode ? 'active' : ''}
                          onClick={() => {
                            setView(mode)
                            localStorage.setItem('sky-places-view', mode)
                          }}
                        >
                          <PlaceIcon name={mode} size={17} />
                          {mode === 'map' ? 'Map' : 'List'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="sky-places-filters">
                    <TextInput
                      aria-label="Search your places"
                      placeholder="Search your places…"
                      leftSection={<PlaceIcon name="search" size={19} />}
                      value={query}
                      onChange={(event) => {
                        setQuery(event.currentTarget.value)
                        setSelected(null)
                      }}
                    />
                    <Select
                      aria-label="Filter by location"
                      placeholder="All locations"
                      data={[
                        ...new Map(
                          all.filter((p) => p.kind !== 'venue').map((p) => [p.ref, { value: p.ref, label: p.name }]),
                        ).values(),
                      ]}
                      value={area}
                      onChange={(value) => {
                        setArea(value)
                        setSelected(null)
                      }}
                      clearable
                      searchable
                      leftSection={<PlaceIcon name="globe" size={17} />}
                    />
                    <Select
                      aria-label="Filter by category"
                      placeholder="All categories"
                      value={category}
                      onChange={(value) => {
                        setCategory(value)
                        setSelected(null)
                      }}
                      clearable
                      data={Object.entries({
                        ...placeCategories,
                        ...Object.fromEntries(Object.entries(placeKinds).filter(([kind]) => kind !== 'venue')),
                      }).map(([value, label]) => ({ value, label }))}
                    />
                  </div>
                  <div className="sky-places-workspace" data-view={view}>
                    <section className="sky-places-results" aria-label="Saved places">
                      <div className="sky-places-results-heading">
                        <span>
                          {filtered.length} {filtered.length === 1 ? 'place' : 'places'}
                        </span>
                        <span>{archived ? 'Archived' : 'Saved in your notebook'}</span>
                      </div>
                      <div className="sky-places-scroll">
                        {filtered.length ? (
                          <>
                            {venues.length > 0 && (
                              <>
                                <h2 className="sky-places-group">
                                  Venues <span>{venues.length}</span>
                                </h2>
                                {rows(venues)}
                              </>
                            )}
                            {areas.length > 0 && (
                              <>
                                <h2 className="sky-places-group">
                                  Cities &amp; areas <span>{areas.length}</span>
                                </h2>
                                {rows(areas)}
                              </>
                            )}
                          </>
                        ) : (
                          <div className="sky-places-no-results">
                            <PlaceIcon name="search" size={28} />
                            <h2>No places found</h2>
                            <p>
                              {archived
                                ? 'No archived places match these filters.'
                                : 'Try a different name or clear your filters.'}
                            </p>
                            <Button onClick={clear}>Clear filters</Button>
                          </div>
                        )}
                      </div>
                      <div className="sky-places-results-footer">
                        <Checkbox
                          size="xs"
                          label="Archived places"
                          checked={archived}
                          onChange={(event) => {
                            setArchived(event.currentTarget.checked)
                            setSelected(null)
                          }}
                        />
                        {view === 'map' && venues.some((p) => !p.coordinates) && (
                          <span>{venues.filter((p) => !p.coordinates).length} without a map location</span>
                        )}
                      </div>
                    </section>
                    {view === 'map' && (
                      <section className="sky-places-map-region" aria-label="Places map">
                        <PlacesMap
                          places={filtered}
                          config={maps}
                          selected={selected}
                          onSelect={setSelected}
                          navigate={navigate}
                          onAdd={(coordinates) => setEditor({ coordinates })}
                          onSetup={() => setSetup(true)}
                        />
                      </section>
                    )}
                  </div>
                </>
              )
            )}
            {index && maps.configurable && (
              <button className="sky-places-map-settings" onClick={() => setSetup(true)}>
                Google Maps settings
              </button>
            )}
          </>
        )}
      </main>
      {editor && (
        <PlacesEditor
          {...editor}
          places={all}
          maps={maps}
          onClose={() => setEditor(null)}
          onSave={saved}
          navigate={navigate}
          onSetup={() => setSetup(true)}
        />
      )}
      {setup && (
        <PlacesSetup
          config={maps}
          onClose={() => setSetup(false)}
          onSaved={(next) => {
            setIndex((old) => (old ? { ...old, maps: next } : old))
            setSetup(false)
            setNotice('Google Maps connection saved.')
          }}
        />
      )}
      <Modal
        opened={noteOpen}
        onClose={saving ? () => {} : () => setNoteOpen(false)}
        title={`Add a note${detail ? ` · ${detail.name}` : ''}`}
        centered
        size="lg"
        className="sky-places-dialog"
      >
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            if (!detail) return
            setSaving(true)
            setNoteError('')
            try {
              setDetail(await placesApi<PlaceDetail>('/note', { id: detail.id, revision: detail.revision, text: note }))
              setNoteOpen(false)
              setNotice('Note added.')
            } catch (error) {
              setNoteError((error as Error).message)
            } finally {
              setSaving(false)
            }
          }}
        >
          <Textarea
            autoFocus
            label="Note"
            minRows={5}
            autosize
            value={note}
            onChange={(event) => setNote(event.currentTarget.value)}
          />
          {noteError && (
            <p role="alert" className="sky-places-error">
              {noteError}
            </p>
          )}
          <div className="sky-places-dialog-footer">
            <Button disabled={saving} onClick={() => setNoteOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={saving} disabled={!note.trim()}>
              Save note
            </Button>
          </div>
        </form>
      </Modal>
      <Modal
        opened={archiveOpen}
        onClose={saving ? () => {} : () => setArchiveOpen(false)}
        title={detail?.archived ? 'Restore this place?' : 'Archive this place?'}
        centered
        size="md"
        className="sky-places-dialog"
      >
        <p className="sky-places-lead">
          {detail?.archived
            ? 'This place will appear in your places again.'
            : 'This place will move out of your active list. Its notebook file, notes, and links will stay intact. You can restore it at any time.'}
        </p>
        {archiveError && (
          <p className="sky-places-error" role="alert">
            {archiveError}
          </p>
        )}
        <div className="sky-places-dialog-footer">
          <Button disabled={saving} onClick={() => setArchiveOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={saving}
            onClick={async () => {
              if (!detail) return
              setSaving(true)
              setArchiveError('')
              try {
                const next = await placesApi<PlaceDetail>('/archive', {
                  id: detail.id,
                  revision: detail.revision,
                  archived: !detail.archived,
                })
                setArchiveOpen(false)
                setLastArchived(next.archived ? next : null)
                setNotice(next.archived ? 'Place archived.' : 'Place restored.')
                setIndex((old) =>
                  old ? { ...old, places: old.places.map((p) => (p.id === next.id ? next : p)) } : old,
                )
                navigate('/places')
              } catch (error) {
                setArchiveError((error as Error).message)
              } finally {
                setSaving(false)
              }
            }}
          >
            {detail?.archived ? 'Restore place' : 'Archive place'}
          </Button>
        </div>
      </Modal>
      {notice && (
        <div className="sky-places-toast" role="status">
          <span>{notice}</span>
          {lastArchived && notice === 'Place archived.' && (
            <button
              onClick={async () => {
                try {
                  await placesApi('/archive', { id: lastArchived.id, revision: lastArchived.revision, archived: false })
                  setLastArchived(null)
                  setNotice('Place restored.')
                  void load()
                } catch (error) {
                  setNotice((error as Error).message)
                }
              }}
            >
              Undo
            </button>
          )}
          <button onClick={() => setNotice('')} aria-label="Dismiss message">
            <PlaceIcon name="close" size={16} />
          </button>
        </div>
      )}
    </>
  )
}
