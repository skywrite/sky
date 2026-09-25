import { Button, Checkbox, Collapse, Modal, Select, TagsInput, Textarea, TextInput } from '@mantine/core'
import { useEffect, useRef, useState } from 'react'
import {
  blankPlace,
  isWithinPlace,
  placeCategories,
  placeHref,
  placeKinds,
  type Coordinates,
  type GooglePlaceResult,
  type MapsConfig,
  type PlaceDetail,
  type PlaceFields,
  type PlaceKind,
  type PlaceSummary,
} from '../../places/types.ts'
import { placesApi } from './placesApi.ts'
import { PlaceAvatar, PlaceIcon } from './placesIcons.tsx'

export function PlacesEditor({
  initial,
  coordinates,
  manual = false,
  places,
  maps,
  onClose,
  onSave,
  navigate,
  onSetup,
}: {
  initial?: PlaceDetail
  coordinates?: Coordinates
  manual?: boolean
  places: PlaceSummary[]
  maps: MapsConfig
  onClose: () => void
  onSave: (place: PlaceDetail) => void
  navigate: (href: string) => void
  onSetup: () => void
}) {
  const [draft, setDraft] = useState<PlaceFields>(initial ?? { ...blankPlace(), coordinates: coordinates ?? null })
  const [mode, setMode] = useState<'search' | 'fields'>(
    initial || coordinates || manual || !maps.searchAvailable ? 'fields' : 'search',
  )
  const [query, setQuery] = useState(''),
    [results, setResults] = useState<GooglePlaceResult[] | null>(null)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [more, setMore] = useState(false)
  const [notes, setNotes] = useState(''),
    [namesake, setNamesake] = useState(false),
    [imported, setImported] = useState(false)
  const [latitude, setLatitude] = useState(String(draft.coordinates?.latitude ?? '')),
    [longitude, setLongitude] = useState(String(draft.coordinates?.longitude ?? ''))
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [])
  const set = <K extends keyof PlaceFields>(key: K, value: PlaceFields[K]) =>
    setDraft((old) => ({ ...old, [key]: value }))
  const duplicates = places.filter(
    (p) =>
      p.id !== initial?.id &&
      [p.name, ...p.aliases].some((name) => name.toLowerCase().trim() === draft.name.toLowerCase().trim()),
  )
  const sameGoogle = places.find(
    (p) => p.id !== initial?.id && draft.googlePlaceId && p.googlePlaceId === draft.googlePlaceId,
  )
  const parents = places.filter(
    (p) => p.kind !== 'venue' && p.id !== initial?.id && (!initial || !isWithinPlace(p, initial.ref, places)),
  )
  const parentOptions = [
    ...new Map(
      parents.map((p) => [
        p.ref,
        { value: p.ref, label: `${p.name} · ${placeKinds[p.kind]}${p.archived ? ' (archived)' : ''}` },
      ]),
    ).values(),
  ]
  if (draft.parent && !parentOptions.some((p) => p.value === draft.parent))
    parentOptions.push({ value: draft.parent, label: `${draft.parent} · unavailable — choose another place` })
  const hasCoordinates = latitude.trim() !== '' || longitude.trim() !== ''
  const coordinateError =
    hasCoordinates &&
    (!latitude.trim() ||
      !longitude.trim() ||
      !Number.isFinite(Number(latitude)) ||
      !Number.isFinite(Number(longitude)) ||
      Math.abs(Number(latitude)) > 90 ||
      Math.abs(Number(longitude)) > 180)
  const search = async () => {
    request.current?.abort()
    const abort = new AbortController()
    request.current = abort
    setBusy(true)
    setError('')
    setResults(null)
    try {
      setResults(await placesApi<GooglePlaceResult[]>('/google/search', { query }, abort.signal))
    } catch (error) {
      if (!abort.signal.aborted) setError((error as Error).message)
    } finally {
      if (!abort.signal.aborted) setBusy(false)
    }
  }
  const choose = async (result: GooglePlaceResult) => {
    if (result.savedRef) {
      onClose()
      navigate(placeHref(result.savedRef))
      return
    }
    const abort = new AbortController()
    request.current?.abort()
    request.current = abort
    setBusy(true)
    setError('')
    try {
      const value = await placesApi<PlaceFields>('/google/detail', { id: result.id }, abort.signal)
      // Suggest only an unambiguous saved geography in the same country; saving remains explicit.
      for (const [kind, name] of [
        ['neighborhood', value.subcity],
        ['city', value.city],
        ['region', value.region],
        ['country', value.country],
      ]) {
        if (!name || value.kind === 'country') continue
        const candidates = parents.filter(
          (p) =>
            p.kind === kind &&
            p.country === value.country &&
            [p.name, ...p.aliases, ...(kind === 'country' ? [p.country] : [])].some(
              (alias) => alias.toLowerCase() === name.toLowerCase(),
            ),
        )
        if (candidates.length === 1 && candidates[0].googlePlaceId !== value.googlePlaceId) {
          value.parent = candidates[0].ref
          break
        }
      }
      setDraft(value)
      setLatitude(String(value.coordinates?.latitude ?? ''))
      setLongitude(String(value.coordinates?.longitude ?? ''))
      setImported(true)
      setMode('fields')
    } catch (error) {
      if (!abort.signal.aborted) setError((error as Error).message)
    } finally {
      if (!abort.signal.aborted) setBusy(false)
    }
  }
  return (
    <Modal
      opened
      onClose={busy ? () => {} : onClose}
      title={initial ? 'Edit place' : 'Add a place'}
      size="lg"
      centered
      className="sky-places-dialog"
      closeOnEscape={!busy}
      closeOnClickOutside={!busy}
      withCloseButton={!busy}
    >
      {!initial && (
        <div className="sky-places-methods">
          <button
            className={mode === 'search' ? 'active' : ''}
            disabled={busy}
            onClick={() => {
              setMode('search')
              setError('')
            }}
          >
            <PlaceIcon name="search" size={17} />
            Find on Google Maps
          </button>
          <button
            className={mode === 'fields' && !imported ? 'active' : ''}
            disabled={busy}
            onClick={() => {
              setMode('fields')
              setError('')
            }}
          >
            Enter manually
          </button>
        </div>
      )}
      {mode === 'search' && (
        <>
          <p className="sky-places-lead">Find a place, then review the details before saving it.</p>
          {maps.searchAvailable ? (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                void search()
              }}
              className="sky-places-search-form"
            >
              <TextInput
                aria-label="Find a place on Google Maps"
                autoFocus
                placeholder="Place name and city"
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                leftSection={<PlaceIcon name="search" />}
              />
              <Button type="submit" variant="primary" disabled={query.trim().length < 2} loading={busy}>
                Search
              </Button>
            </form>
          ) : (
            <div className="sky-places-lookup-empty">
              <h3>Connect Google Places to search</h3>
              <p>You can also start with a name and enter the details yourself.</p>
              {maps.configurable && <Button onClick={onSetup}>Connect Google Places</Button>}
            </div>
          )}
          {results && (
            <div className="sky-places-lookup-results">
              <div className="sky-places-lookup-label">
                <span>{results.length ? 'Matching places' : 'No matching places'}</span>
                <span>Google Maps</span>
              </div>
              {results.map((result) => (
                <div key={result.id}>
                  <button className="sky-places-lookup-result" disabled={busy} onClick={() => void choose(result)}>
                    <PlaceAvatar place={result} />
                    <span>
                      <strong>{result.name}</strong>
                      <small>{result.address}</small>
                    </span>
                    {result.savedRef ? <small>Saved</small> : <PlaceIcon name="right" size={18} />}
                  </button>
                  {result.attributions.map((item) => (
                    <a
                      className="sky-places-attribution"
                      key={item.uri}
                      href={item.uri}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {item.name}
                    </a>
                  ))}
                </div>
              ))}
              {!results.length && <p>Try a different name or include a city.</p>}
            </div>
          )}
          <div className="sky-places-lookup-footer">
            <span>Can’t find your place?</span>
            <Button
              variant="primary-quiet"
              onClick={() => {
                setMode('fields')
                set('name', query.trim())
              }}
            >
              Add it manually
            </Button>
          </div>
        </>
      )}
      {mode === 'fields' && (
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            setBusy(true)
            setError('')
            try {
              onSave(
                await placesApi<PlaceDetail>('/place', {
                  ...draft,
                  name: draft.name.trim(),
                  coordinates: hasCoordinates ? { latitude: Number(latitude), longitude: Number(longitude) } : null,
                  ...(initial ? { id: initial.id, revision: initial.revision } : { notes }),
                  allowNamesake: namesake,
                }),
              )
            } catch (error) {
              setError((error as Error).message)
            } finally {
              setBusy(false)
            }
          }}
        >
          {imported && <p className="sky-places-import-summary">Details from Google Maps · Review before saving</p>}
          {!initial && !imported && (
            <p className="sky-places-lead">A name is enough to start. Add the details you know.</p>
          )}
          <div className="sky-places-form">
            <TextInput
              required
              autoFocus
              label="Name"
              value={draft.name}
              onChange={(event) => {
                set('name', event.currentTarget.value)
                setNamesake(false)
              }}
            />
            <div className="sky-places-form-columns">
              <Select
                label="Kind of place"
                data={Object.entries(placeKinds).map(([value, label]) => ({ value, label }))}
                value={draft.kind}
                allowDeselect={false}
                onChange={(value) => {
                  set('kind', value as PlaceKind)
                  if (value === 'country') set('parent', '')
                }}
              />
              {draft.kind === 'venue' && (
                <Select
                  label="Category"
                  value={draft.category}
                  data={[
                    ...Object.entries(placeCategories).map(([value, label]) => ({ value, label })),
                    ...(!placeCategories[draft.category] && draft.category
                      ? [{ value: draft.category, label: draft.category }]
                      : []),
                  ]}
                  allowDeselect={false}
                  onChange={(value) => set('category', value || '')}
                />
              )}
            </div>
            {draft.kind !== 'country' && (
              <Select
                label="Located in"
                description="Connect this place to a saved city, neighborhood, or region."
                placeholder="Choose a place (optional)"
                data={parentOptions}
                value={draft.parent || null}
                searchable
                clearable
                onChange={(value) => set('parent', value || '')}
              />
            )}
            {draft.kind === 'venue' && (
              <TextInput
                label="Address"
                value={draft.address}
                onChange={(event) => set('address', event.currentTarget.value)}
              />
            )}
            {!initial && (
              <Textarea
                label="Notes"
                placeholder="What would you like to remember about this place?"
                minRows={3}
                autosize
                value={notes}
                onChange={(event) => setNotes(event.currentTarget.value)}
              />
            )}
            <button type="button" className="sky-places-more" aria-expanded={more} onClick={() => setMore(!more)}>
              <PlaceIcon name={more ? 'down' : 'right'} size={16} />
              More details<span>Website, aliases, coordinates</span>
            </button>
            <Collapse in={more}>
              <div className="sky-places-form">
                <TextInput
                  label="Website"
                  placeholder="https://example.com"
                  value={draft.site}
                  onChange={(event) => set('site', event.currentTarget.value)}
                />
                <TagsInput
                  label="Also known as"
                  value={draft.aliases}
                  onChange={(value) => set('aliases', value)}
                  placeholder="Add an alias"
                />
                <div className="sky-places-form-columns">
                  <TextInput
                    label="Country code"
                    placeholder="FR"
                    maxLength={2}
                    value={draft.country}
                    onChange={(event) => set('country', event.currentTarget.value.toUpperCase())}
                  />
                  <TextInput
                    label="Region"
                    value={draft.region}
                    onChange={(event) => set('region', event.currentTarget.value)}
                  />
                  <TextInput
                    label="City"
                    value={draft.city}
                    onChange={(event) => set('city', event.currentTarget.value)}
                  />
                  <TextInput
                    label="Neighborhood"
                    value={draft.subcity}
                    onChange={(event) => set('subcity', event.currentTarget.value)}
                  />
                </div>
                <div className="sky-places-form-columns">
                  <TextInput
                    label="Latitude"
                    inputMode="decimal"
                    value={latitude}
                    onChange={(event) => setLatitude(event.currentTarget.value)}
                  />
                  <TextInput
                    label="Longitude"
                    inputMode="decimal"
                    value={longitude}
                    onChange={(event) => setLongitude(event.currentTarget.value)}
                  />
                </div>
              </div>
            </Collapse>
            {coordinateError && (
              <p className="sky-places-error" role="alert">
                Enter both coordinates: latitude between −90 and 90, longitude between −180 and 180.
              </p>
            )}
            {hasCoordinates && !more && (
              <button type="button" className="sky-places-coordinate-status" onClick={() => setMore(true)}>
                <PlaceIcon name="pin" size={16} />
                Location on map included · Adjust
              </button>
            )}
            {(duplicates.length > 0 || sameGoogle) && (
              <div className="sky-places-duplicates">
                <strong>
                  {sameGoogle ? 'This Google place is already saved.' : 'You have a place with this name.'}
                </strong>
                {(sameGoogle ? [sameGoogle] : duplicates).map((place) => (
                  <a
                    href={placeHref(place.ref)}
                    key={place.id}
                    onClick={(event) => {
                      if (event.metaKey || event.ctrlKey) return
                      event.preventDefault()
                      onClose()
                      navigate(placeHref(place.ref))
                    }}
                  >
                    {place.name}
                    {place.locationLabel ? ` · ${place.locationLabel}` : ''}
                    {place.archived ? ' (archived)' : ''}
                  </a>
                ))}
                {!sameGoogle && (
                  <Checkbox
                    label="This is a different place with the same name"
                    checked={namesake}
                    onChange={(event) => setNamesake(event.currentTarget.checked)}
                  />
                )}
              </div>
            )}
            {initial && (
              <p className="sky-places-setup-hint">
                Your existing notes are preserved. Use Add note or open the notebook file to edit them.
              </p>
            )}
          </div>
          {error && (
            <p className="sky-places-error" role="alert">
              {error}
            </p>
          )}
          <div className="sky-places-dialog-footer">
            <Button onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={busy}
              disabled={
                !draft.name.trim() || coordinateError || Boolean(sameGoogle) || (duplicates.length > 0 && !namesake)
              }
            >
              {initial ? 'Save changes' : 'Add place'}
            </Button>
          </div>
        </form>
      )}
      {mode === 'search' && error && (
        <p className="sky-places-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  )
}
