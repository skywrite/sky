/// <reference types="google.maps" />
import { Button, useComputedColorScheme } from '@mantine/core'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { placeHref, placeLabel, type Coordinates, type MapsConfig, type PlaceSummary } from '../../places/types.ts'
import { PlaceAvatar, PlaceIcon, placeIconName } from './placesIcons.tsx'

let loading: Promise<typeof google.maps> | undefined
let loadingKey = ''
function loadMaps(key: string): Promise<typeof google.maps> {
  if (loading && loadingKey !== key) return Promise.reject(new Error('Reload Sky to use the updated browser map key.'))
  if (loading) return loading
  loadingKey = key
  const host = window as unknown as {
    google?: { maps: typeof google.maps }
    skyPlacesMapsReady?: () => void
    gm_authFailure?: () => void
  }
  loading = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    const fail = () => {
      clearTimeout(timeout)
      script.remove()
      loading = undefined
      reject(
        new Error('Google Maps could not load. Check your connection, browser key, and Maps JavaScript API settings.'),
      )
    }
    const timeout = setTimeout(fail, 20_000)
    host.skyPlacesMapsReady = () => {
      clearTimeout(timeout)
      if (host.google?.maps) resolve(host.google.maps)
      else fail()
    }
    host.gm_authFailure = () => {
      fail()
      window.dispatchEvent(new Event('sky-places-map-error'))
    }
    script.async = true
    script.src = `https://maps.googleapis.com/maps/api/js?${new URLSearchParams({ key, loading: 'async', callback: 'skyPlacesMapsReady', libraries: 'marker', v: 'weekly', auth_referrer_policy: 'origin' })}`
    script.onerror = fail
    document.head.append(script)
  })
  return loading
}
const position = (coordinates: Coordinates) => ({ lat: coordinates.latitude, lng: coordinates.longitude })
const zoomFor = (place: PlaceSummary) =>
  place.kind === 'venue' ? 15 : place.kind === 'country' ? 4 : place.kind === 'region' ? 7 : 11

export function PlacesMap({
  places,
  config,
  selected = null,
  onSelect,
  navigate,
  onAdd,
  onSetup,
  mini = false,
}: {
  places: PlaceSummary[]
  config: MapsConfig
  selected?: string | null
  onSelect?: (ref: string | null) => void
  navigate: (href: string) => void
  onAdd?: (coordinates: Coordinates) => void
  onSetup: () => void
  mini?: boolean
}) {
  const container = useRef<HTMLDivElement | null>(null)
  const [map, setMap] = useState<google.maps.Map | null>(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [placing, setPlacing] = useState(false)
  const [dropped, setDropped] = useState<Coordinates | null>(null)
  const [portals, setPortals] = useState<Array<{ place: PlaceSummary; element: HTMLSpanElement }>>([])
  const markers = useRef<
    Array<{ ref: string; marker: google.maps.marker.AdvancedMarkerElement; element: HTMLSpanElement }>
  >([])
  const callbacks = useRef({ onSelect, onAdd, placing })
  callbacks.current = { onSelect, onAdd, placing }
  const scheme = useComputedColorScheme('light')
  const pointKey = JSON.stringify(
    places
      .filter((p) => p.coordinates)
      .map((p) => ({
        id: p.id,
        ref: p.ref,
        name: p.name,
        kind: p.kind,
        category: p.category,
        coordinates: p.coordinates,
      })),
  )
  // Polls with unchanged coordinates keep the viewport and Google's marker DOM intact.
  const points = useMemo(() => places.filter((p) => p.coordinates), [pointKey])
  const chosen = places.find((p) => p.ref === selected)
  useEffect(() => {
    if (!config.browserKey || !container.current) return
    let cancelled = false
    let instance: google.maps.Map | undefined
    setError('')
    const failed = () =>
      setError(
        'Google refused this map key. Check website restrictions, billing, and that Maps JavaScript API is enabled.',
      )
    window.addEventListener('sky-places-map-error', failed)
    void loadMaps(config.browserKey)
      .then(async (api) => {
        const { AdvancedMarkerElement } = (await api.importLibrary('marker')) as google.maps.MarkerLibrary
        if (cancelled || !container.current || !AdvancedMarkerElement) return
        instance = new api.Map(container.current, {
          center: { lat: 20, lng: 0 },
          zoom: 2,
          mapId: config.mapId || 'DEMO_MAP_ID',
          colorScheme: scheme === 'dark' ? api.ColorScheme.DARK : api.ColorScheme.LIGHT,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: !mini,
          zoomControl: !mini,
          clickableIcons: false,
          gestureHandling: 'cooperative',
        })
        instance.addListener('click', (event: google.maps.MapMouseEvent) => {
          if (callbacks.current.placing && event.latLng)
            setDropped({ latitude: event.latLng.lat(), longitude: event.latLng.lng() })
          else callbacks.current.onSelect?.(null)
        })
        setMap(instance)
      })
      .catch((problem) => {
        if (!cancelled) setError(problem.message)
      })
    return () => {
      cancelled = true
      window.removeEventListener('sky-places-map-error', failed)
      if (instance) google.maps.event.clearInstanceListeners(instance)
      setMap(null)
    }
  }, [config.browserKey, config.mapId, scheme, retry, mini])
  const fit = () => {
    if (!map || !points.length) return
    const venues = points.filter((p) => p.kind === 'venue'),
      shown = venues.length ? venues : points
    if (shown.length === 1) {
      map.setCenter(position(shown[0].coordinates!))
      map.setZoom(zoomFor(shown[0]))
      return
    }
    const bounds = new google.maps.LatLngBounds()
    for (const p of shown) bounds.extend(position(p.coordinates!))
    map.fitBounds(bounds, mini ? 25 : 60)
    google.maps.event.addListenerOnce(map, 'idle', () => {
      if ((map.getZoom() ?? 0) > 16) map.setZoom(16)
    })
  }
  useEffect(() => {
    if (!map) return
    const nodes = points.map((place) => {
      const element = document.createElement('span')
      element.className = 'sky-places-pin'
      element.dataset.kind = place.kind === 'venue' ? place.category : place.kind
      const marker = new google.maps.marker.AdvancedMarkerElement({
        map,
        position: position(place.coordinates!),
        title: `Select ${place.name}`,
        content: element,
        gmpClickable: !mini,
      })
      marker.addListener('click', () => callbacks.current.onSelect?.(place.ref))
      return { ref: place.ref, marker, element, place }
    })
    markers.current = nodes
    setPortals(nodes)
    fit()
    return () => {
      for (const { marker } of nodes) {
        marker.map = null
        google.maps.event.clearInstanceListeners(marker)
      }
      markers.current = []
    }
  }, [map, points, mini])
  useEffect(() => {
    for (const item of markers.current) {
      item.element.dataset.selected = String(item.ref === selected)
      item.marker.zIndex = item.ref === selected ? 1000 : 1
    }
    if (chosen?.coordinates && map) {
      map.panTo(position(chosen.coordinates))
      if ((map.getZoom() ?? 0) < zoomFor(chosen) - 2) map.setZoom(zoomFor(chosen) - 2)
    }
  }, [selected, map, points])
  useEffect(() => {
    if (!map || !dropped) return
    const marker = new google.maps.marker.AdvancedMarkerElement({
      map,
      position: position(dropped),
      title: 'New place location',
    })
    return () => {
      marker.map = null
    }
  }, [map, dropped])
  useEffect(() => {
    map?.setOptions({ draggableCursor: placing ? 'crosshair' : undefined })
  }, [map, placing])
  return (
    <div className="sky-places-map" data-mini={mini}>
      <div ref={container} className="sky-places-map-canvas" aria-label="Google map of saved places" />
      {portals.map(({ place, element }) =>
        createPortal(
          <span>
            <PlaceIcon name={placeIconName(place)} size={20} />
          </span>,
          element,
          place.id,
        ),
      )}
      {!config.browserKey || error ? (
        <div className="sky-places-map-status">
          <PlaceIcon name="map" size={34} />
          <h3>{error ? 'Map unavailable' : 'See your places on a map'}</h3>
          <p>{error || 'Connect Google Maps to explore your saved places and drop a pin.'}</p>
          {config.configurable && (
            <Button onClick={onSetup}>{config.browserKey ? 'Map settings' : 'Connect Google Maps'}</Button>
          )}
          {error && (
            <Button
              variant="primary-quiet"
              onClick={() =>
                error.startsWith('Reload Sky') ? window.location.reload() : setRetry((value) => value + 1)
              }
            >
              {error.startsWith('Reload Sky') ? 'Reload Sky' : 'Try again'}
            </Button>
          )}
        </div>
      ) : !map ? (
        <div className="sky-places-map-status" role="status">
          Loading Google Maps…
        </div>
      ) : (
        <>
          {!mini && (
            <div className="sky-places-map-controls">
              <button onClick={fit} aria-label="Show all places on map">
                <PlaceIcon name="locate" size={17} />
                {points.length} on map
              </button>
              {onAdd && (
                <button
                  aria-pressed={placing}
                  onClick={() => {
                    setPlacing(!placing)
                    setDropped(null)
                    onSelect?.(null)
                  }}
                >
                  <PlaceIcon name="pin" size={17} />
                  {placing ? 'Cancel pin' : 'Drop a pin'}
                </button>
              )}
            </div>
          )}
          {placing && !dropped && (
            <div className="sky-places-map-instruction" role="status">
              Click the map to choose a location.
              <button
                onClick={() => {
                  const center = map.getCenter()
                  if (center) setDropped({ latitude: center.lat(), longitude: center.lng() })
                }}
              >
                Use map center
              </button>
            </div>
          )}
          {dropped && placing && (
            <div className="sky-places-map-preview">
              <strong>New place here</strong>
              <p>
                {dropped.latitude.toFixed(5)}, {dropped.longitude.toFixed(5)}
              </p>
              <Button
                variant="primary"
                onClick={() => {
                  onAdd?.(dropped)
                  setPlacing(false)
                  setDropped(null)
                }}
              >
                Add place here
              </Button>
            </div>
          )}
          {chosen && !mini && !placing && (
            <div className="sky-places-map-preview">
              <div className="sky-places-preview-heading">
                <PlaceAvatar place={chosen} />
                <div>
                  <strong>{chosen.name}</strong>
                  <small>{placeLabel(chosen)}</small>
                </div>
                <button onClick={() => onSelect?.(null)} aria-label="Close place preview">
                  <PlaceIcon name="close" size={16} />
                </button>
              </div>
              <p>{chosen.address || chosen.locationLabel}</p>
              <Button variant="primary-quiet" onClick={() => navigate(placeHref(chosen.ref))}>
                View place <PlaceIcon name="right" size={16} />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
