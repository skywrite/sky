import './LocationPicker.css'
import { Button, CloseButton, Combobox, InputBase, Loader, Select, useCombobox } from '@mantine/core'
import { useEffect, useMemo, useRef, useState } from 'react'
import { normalizePlaceRef } from '#shared/models/Place/reference.ts'
import {
  placeKinds,
  type LocationChoice,
  type LocationSearchResult,
  type LocationsIndex,
} from '../../../service/handler/places/types.ts'
import { placesApi } from './placesApi.ts'

const errorText = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong. Try again.')
const fold = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().trim()
const LIMIT = 8
// Option values that are actions rather than places; a place reference never starts with a space
const FIND = ' find'
const ADD = ' add'
const FOUND = ' found:'

/** Places whose description or names start with, then contain, the search; saved places before unsaved countries. */
function matching(choices: LocationChoice[], query: string): LocationChoice[] {
  const q = fold(query)
  if (!q) return []
  return choices
    .flatMap((choice) => {
      const label = fold(choice.label)
      const names = [choice.name, ...choice.aliases].map(fold)
      const rank = label.startsWith(q)
        ? 0
        : names.some((name) => name.startsWith(q))
          ? 1
          : label.split(/[\s,]+/).some((word) => word.startsWith(q))
            ? 2
            : label.includes(q) || names.some((name) => name.includes(q))
              ? 3
              : -1
      return rank < 0 ? [] : [{ choice, rank: rank + (choice.needsCreation ? 0.5 : 0) }]
    })
    .sort((a, b) => a.rank - b.rank || a.choice.label.localeCompare(b.choice.label))
    .slice(0, LIMIT)
    .map((item) => item.choice)
}

/**
 * Where someone is located: a saved city, region or country, shown as it reads (Burlington, VT, USA)
 * and saved as the place's reference. A city that is not saved yet is found on Google Maps and
 * saved with its state and country, or, without Google Maps, added by hand inside a country.
 * Text from before places stays until it is replaced, with the saved place it names offered.
 */
export function LocationPicker({
  value,
  valueLabel = '',
  label = 'Location',
  compact = false,
  autoFocus = false,
  onChange,
}: {
  /** A saved place's reference, text from before places, or empty */
  value: string
  /** How the current value reads when the list does not hold it */
  valueLabel?: string
  label?: string
  /** A field inside a row that already names it, as the explorer shows a document's fields */
  compact?: boolean
  autoFocus?: boolean
  onChange: (value: string) => void
}) {
  const [index, setIndex] = useState<LocationsIndex | null>(null)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(false)
  const [found, setFound] = useState<LocationSearchResult[] | null>(null)
  const [busy, setBusy] = useState<'find' | 'add' | null>(null)
  const [error, setError] = useState('')
  const [manual, setManual] = useState<string | null>(null)
  const [inside, setInside] = useState<string | null>(null)
  const [suggestion, setSuggestion] = useState<LocationChoice | null>(null)
  const combobox = useCombobox({ onDropdownClose: () => combobox.resetSelectedOption() })
  const clickFocus = useRef(false)

  useEffect(() => {
    const abort = new AbortController()
    placesApi<LocationsIndex>('/locations', undefined, abort.signal).then(
      (next) => {
        if (!abort.signal.aborted) setIndex(next)
      },
      (failure) => {
        if (!abort.signal.aborted) setError(`Your places could not be loaded. ${errorText(failure)}`)
      },
    )
    return () => abort.abort()
  }, [])

  const choices = index?.choices ?? []
  const ref = normalizePlaceRef(value)
  const current = ref ? choices.find((choice) => choice.ref.toLowerCase() === ref.toLowerCase()) : undefined
  const shown = current?.label ?? (ref ? valueLabel || value : value)
  // Text from before places, or a link to a place with no record: what the field still has to resolve
  const unsaved = value.trim() && index && !current ? shown : ''

  useEffect(() => {
    setSuggestion(null)
    if (!unsaved) return
    const abort = new AbortController()
    placesApi<LocationChoice | null>('/locations/match', { text: unsaved }, abort.signal).then(
      (match) => {
        if (!abort.signal.aborted) setSuggestion(match)
      },
      () => {},
    )
    return () => abort.abort()
  }, [unsaved])

  const typed = query.trim()
  const options = useMemo(() => matching(choices, typed), [choices, typed])
  const insideOptions = useMemo(
    () =>
      choices
        .filter((choice) => choice.kind === 'country' || choice.kind === 'region' || choice.kind === 'area')
        .sort((a, b) => Number(!!a.needsCreation) - Number(!!b.needsCreation) || a.label.localeCompare(b.label))
        .map((choice) => ({ value: choice.ref, label: choice.label })),
    [choices],
  )

  const choose = (choice: LocationChoice) => {
    onChange(choice.ref)
    setEditing(false)
    setQuery('')
    setFound(null)
    setError('')
    setManual(null)
    combobox.closeDropdown()
  }
  const find = async () => {
    setBusy('find')
    setError('')
    try {
      setFound(await placesApi<LocationSearchResult[]>('/locations/search', { query: typed }))
      combobox.openDropdown()
    } catch (failure) {
      setError(errorText(failure))
    } finally {
      setBusy(null)
    }
  }
  const add = async (body: { googlePlaceId: string } | { name: string; inside: string }) => {
    setBusy('add')
    setError('')
    try {
      const choice = await placesApi<LocationChoice>('/locations/add', body)
      // Saving a city can save its state and country too; list them all
      setIndex(await placesApi<LocationsIndex>('/locations'))
      choose(choice)
    } catch (failure) {
      setError(errorText(failure))
    } finally {
      setBusy(null)
    }
  }
  const submit = (option: string) => {
    if (option === FIND) {
      void find()
      return
    }
    if (option === ADD) {
      setManual(typed)
      setInside(null)
      combobox.closeDropdown()
      return
    }
    if (option.startsWith(FOUND)) {
      const result = found?.find((item) => item.id === option.slice(FOUND.length))
      const saved = result?.savedRef && choices.find((choice) => choice.ref === result.savedRef)
      if (saved) choose(saved)
      else if (result) void add({ googlePlaceId: result.id })
      return
    }
    const choice = choices.find((item) => item.ref === option)
    if (choice) choose(choice)
  }

  return (
    <div className="sky-location">
      <Combobox
        store={combobox}
        withinPortal
        onOptionSubmit={submit}
        {...(compact ? { width: 440, position: 'bottom-start' as const } : {})}
      >
        <Combobox.Target>
          <InputBase
            label={compact ? undefined : label}
            aria-label={compact ? label : undefined}
            variant={compact ? 'unstyled' : undefined}
            size={compact ? 'sm' : undefined}
            className={compact ? 'sky-prop-input' : undefined}
            autoFocus={autoFocus}
            placeholder="City, state, or country"
            value={editing ? query : shown}
            onChange={(event) => {
              setEditing(true)
              setQuery(event.currentTarget.value)
              setFound(null)
              combobox.openDropdown()
              combobox.updateSelectedOptionIndex()
            }}
            onFocus={(event) => {
              // The current place stays, selected, so typing replaces it; the text shown is already the query
              setEditing(true)
              setQuery(shown)
              combobox.openDropdown()
              event.currentTarget.select()
            }}
            onMouseDown={(event) => {
              clickFocus.current = document.activeElement !== event.currentTarget
            }}
            onMouseUp={(event) => {
              // The click that focused the field would otherwise drop the selection where it landed
              if (clickFocus.current) event.preventDefault()
              clickFocus.current = false
            }}
            onClick={() => combobox.openDropdown()}
            onBlur={() => {
              setEditing(false)
              setQuery('')
              combobox.closeDropdown()
            }}
            // In the explorer, the row's own remove button clears it
            rightSection={
              busy ? (
                <Loader size="xs" aria-label={busy === 'find' ? 'Searching Google Maps' : 'Saving the place'} />
              ) : compact ? null : value ? (
                <CloseButton
                  size="sm"
                  aria-label="Clear location"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onChange('')
                    setManual(null)
                  }}
                />
              ) : (
                <Combobox.Chevron />
              )
            }
            rightSectionPointerEvents={value && !busy && !compact ? 'all' : 'none'}
            error={error || undefined}
          />
        </Combobox.Target>
        <Combobox.Dropdown className={compact ? 'sky-props-dropdown' : undefined}>
          <Combobox.Options mah={320} style={{ overflowY: 'auto' }}>
            {!typed && <Combobox.Empty>Type a city, state, or country</Combobox.Empty>}
            {options.map((choice) => (
              <Combobox.Option value={choice.ref} key={choice.ref}>
                <span className="sky-location-option">
                  <span>{choice.label}</span>
                  <small>{placeKinds[choice.kind]}</small>
                </span>
              </Combobox.Option>
            ))}
            {found && found.length > 0 && (
              <Combobox.Group label="On Google Maps">
                {found.map((result) => (
                  <Combobox.Option value={`${FOUND}${result.id}`} key={result.id}>
                    <span className="sky-location-option">
                      <span>{result.label}</span>
                      <small>{result.savedRef ? 'Saved' : `Add ${placeKinds[result.kind].toLowerCase()}`}</small>
                    </span>
                  </Combobox.Option>
                ))}
              </Combobox.Group>
            )}
            {found && found.length === 0 && (
              <Combobox.Empty>Google Maps found no city, state, or country called “{typed}”.</Combobox.Empty>
            )}
            {typed.length >= 2 && index?.searchAvailable && !found && (
              <Combobox.Option value={FIND} disabled={busy !== null}>
                <span className="sky-location-action">Find “{typed}” on Google Maps</span>
              </Combobox.Option>
            )}
            {typed && index && !index.searchAvailable && (
              <Combobox.Option value={ADD}>
                <span className="sky-location-action">Add “{typed}” as a new city…</span>
              </Combobox.Option>
            )}
          </Combobox.Options>
        </Combobox.Dropdown>
      </Combobox>
      {unsaved && !editing && manual === null && (
        <p className="sky-location-note">
          <span>Not linked to a saved place yet.{suggestion ? '' : ' Search for it above to choose or add it.'}</span>
          {suggestion && (
            <Button size="compact-sm" variant="light" onClick={() => choose(suggestion)}>
              Use {suggestion.label}
            </Button>
          )}
        </p>
      )}
      {manual !== null && (
        <div className="sky-location-add" role="group" aria-label={`Add ${manual}`}>
          <Select
            label={`Where is ${manual}?`}
            placeholder="Choose its country or state"
            searchable
            data={insideOptions}
            value={inside}
            onChange={setInside}
            comboboxProps={{ withinPortal: true }}
          />
          <div className="sky-location-add-actions">
            <Button disabled={!inside || busy !== null} onClick={() => inside && void add({ name: manual, inside })}>
              Add {manual}
            </Button>
            <Button variant="subtle" onClick={() => setManual(null)}>
              Cancel
            </Button>
          </div>
          <small>Set up Google Maps in Places to find cities with their state and map location.</small>
        </div>
      )}
    </div>
  )
}
