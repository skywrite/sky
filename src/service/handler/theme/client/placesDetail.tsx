import { Button, Menu } from '@mantine/core'
import { type Key, type ReactNode, useState } from 'react'
import {
  placeHref,
  placeLabel,
  placeMapHref,
  type MapsConfig,
  type PlaceDetail,
  type PlaceSummary,
} from '../../places/types.ts'
import { fileHref } from './explorer.tsx'
import { PlaceAvatar, PlaceIcon } from './placesIcons.tsx'
import { PlacesMap } from './placesMap.tsx'
import { RenderedHtml } from './renderedHtml.tsx'

export function PlaceLink({
  href,
  navigate,
  children,
  className,
  label,
}: {
  href: string
  navigate: (href: string) => void
  children: ReactNode
  className?: string
  label?: string
  key?: Key
}) {
  return (
    <a
      href={href}
      className={className}
      aria-label={label}
      onClick={(event) => {
        if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        navigate(href)
      }}
    >
      {children}
    </a>
  )
}
export function PlaceRow({
  place,
  navigate,
  selected,
  onSelect,
  full = false,
}: {
  place: PlaceSummary
  navigate: (href: string) => void
  selected?: boolean
  onSelect?: () => void
  full?: boolean
  key?: Key
}) {
  const copy = (
    <>
      <PlaceAvatar place={place} />
      <span className="sky-places-row-copy">
        <strong>{place.name}</strong>
        <span>
          {placeLabel(place)}
          {!full && place.locationLabel ? ` · ${place.locationLabel}` : ''}
        </span>
        {place.archived ? (
          <small>Archived</small>
        ) : !place.coordinates && place.kind === 'venue' ? (
          <small>
            <PlaceIcon name="pin" size={12} />
            No map location yet
          </small>
        ) : null}
      </span>
      {full && (
        <>
          <span className="sky-places-row-location">{place.locationLabel || '—'}</span>
          <span className="sky-places-row-connections">{place.connections || '—'}</span>
        </>
      )}
    </>
  )
  return (
    <div className="sky-places-row" data-selected={selected} data-full={full}>
      {onSelect ? (
        <button className="sky-places-row-main" onClick={onSelect}>
          {copy}
        </button>
      ) : (
        <PlaceLink href={placeHref(place.ref)} navigate={navigate} className="sky-places-row-main">
          {copy}
        </PlaceLink>
      )}
      <PlaceLink
        href={placeHref(place.ref)}
        navigate={navigate}
        className="sky-places-row-open"
        label={`Open ${place.name}`}
      >
        <PlaceIcon name="right" size={18} />
      </PlaceLink>
    </div>
  )
}
export function PlacesDetail({
  place,
  maps,
  navigate,
  onEdit,
  onNote,
  onArchive,
  onSetup,
}: {
  key?: Key
  place: PlaceDetail
  maps: MapsConfig
  navigate: (href: string) => void
  onEdit: () => void
  onNote: () => void
  onArchive: () => void
  onSetup: () => void
}) {
  const [tab, setTab] = useState('overview')
  const geographic = place.kind !== 'venue'
  const connectionLabel = (via: string) =>
    via === 'where' ? 'Held here' : via === 'location' ? 'Located here' : 'About this place'
  const activity = (
    <ul className="sky-places-activity">
      {place.activity.map((item) => (
        <li key={item.path}>
          <PlaceIcon name="document" size={20} />
          <PlaceLink href={fileHref(item.path)} navigate={navigate}>
            <strong>{item.label}</strong>
            <small>{connectionLabel(item.via)}</small>
          </PlaceLink>
          {item.date && <time dateTime={item.date}>{item.date.slice(0, 10)}</time>}
        </li>
      ))}
    </ul>
  )
  return (
    <>
      <div className="sky-places-detail-top">
        <PlaceLink href="/places" navigate={navigate}>
          ‹ Places
        </PlaceLink>
        <div>
          <a href={placeMapHref(place)} target="_blank" rel="noreferrer">
            Open in Google Maps <PlaceIcon name="external" size={15} />
          </a>
          <Menu withinPortal position="bottom-end">
            <Menu.Target>
              <Button aria-label="Place actions" variant="subtle">
                <PlaceIcon name="more" />
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item onClick={() => navigate(fileHref(place.id))}>Open notebook file</Menu.Item>
              <Menu.Item onClick={onArchive}>{place.archived ? 'Restore place' : 'Archive place'}</Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </div>
      </div>
      <header className="sky-places-detail-heading">
        <PlaceAvatar place={place} large />
        <div>
          <p>
            {placeLabel(place)}
            {place.archived ? ' · Archived' : ''}
          </p>
          <h1>{place.name}</h1>
          {place.ancestors.length > 0 && (
            <nav className="sky-places-breadcrumbs" aria-label="Containing places">
              {place.ancestors.map((parent) => (
                <span key={parent.id}>
                  <PlaceLink href={placeHref(parent.ref)} navigate={navigate}>
                    {parent.name}
                  </PlaceLink>
                  <PlaceIcon name="right" size={12} />
                </span>
              ))}
            </nav>
          )}
        </div>
        <div className="sky-places-detail-actions">
          <Button leftSection={<PlaceIcon name="note" size={17} />} onClick={onNote}>
            Add note
          </Button>
          <Button leftSection={<PlaceIcon name="edit" size={17} />} onClick={onEdit}>
            Edit
          </Button>
        </div>
      </header>
      <div className="sky-places-detail-columns">
        <div className="sky-places-story">
          <nav className="sky-places-detail-tabs" aria-label="Place details">
            <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>
              Overview
            </button>
            {geographic && (
              <button className={tab === 'places' ? 'active' : ''} onClick={() => setTab('places')}>
                Places here <span>{place.children.length}</span>
              </button>
            )}
            <button className={tab === 'connections' ? 'active' : ''} onClick={() => setTab('connections')}>
              Connections <span>{place.activity.length}</span>
            </button>
          </nav>
          {tab === 'overview' && (
            <>
              <section>
                {place.html ? (
                  <>
                    <h2>Notes</h2>
                    <RenderedHtml html={place.html} className="sky-places-prose" />
                  </>
                ) : (
                  <div className="sky-places-note-empty">
                    <h2>Make this place yours</h2>
                    <p>Add what you want to remember: a favorite table, travel plans, or why this place matters.</p>
                    <Button variant="primary-quiet" onClick={onNote}>
                      Add a note
                    </Button>
                  </div>
                )}
                {place.tags.length > 0 && (
                  <div className="sky-places-tags">
                    {place.tags.map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                  </div>
                )}
              </section>
              {geographic && (
                <section>
                  <h2>
                    Places here <span className="sky-places-count">{place.children.length}</span>
                  </h2>
                  {place.children.length ? (
                    <>
                      {place.children.slice(0, 5).map((child) => (
                        <PlaceRow key={child.id} place={child} navigate={navigate} />
                      ))}
                      {place.children.length > 5 && (
                        <Button variant="primary-quiet" onClick={() => setTab('places')}>
                          View all {place.children.length} places
                        </Button>
                      )}
                    </>
                  ) : (
                    <p>Places you add within {place.name} will appear here.</p>
                  )}
                </section>
              )}
              {place.people.length > 0 && (
                <section>
                  <h2>Connected people &amp; organizations</h2>
                  {place.people.map((person) => (
                    <PlaceLink href={person.href} navigate={navigate} key={person.id} className="sky-places-person">
                      <span>
                        <PlaceIcon name={person.type === 'person' ? 'people' : 'building'} size={23} />
                      </span>
                      <div>
                        <strong>{person.name}</strong>
                        <small>{person.via}</small>
                      </div>
                      <PlaceIcon name="right" size={17} />
                    </PlaceLink>
                  ))}
                </section>
              )}
              {place.activity.length > 0 && (
                <section>
                  <h2>From your notebook</h2>
                  {activity}
                </section>
              )}
            </>
          )}
          {tab === 'places' && (
            <section>
              {place.children.length ? (
                place.children.map((child) => <PlaceRow key={child.id} place={child} navigate={navigate} />)
              ) : (
                <p>Choose this place in “Located in” when adding another place.</p>
              )}
            </section>
          )}
          {tab === 'connections' && (
            <section>
              <h2>Connected records</h2>
              <p>Where this place appears in your notebook.</p>
              {place.activity.length ? activity : <p>Link a note, meeting, or person to see it here.</p>}
            </section>
          )}
        </div>
        <aside className="sky-places-details-rail" aria-label="Place information">
          <div className="sky-places-detail-map">
            {place.coordinates ? (
              <PlacesMap places={[place]} config={maps} mini navigate={navigate} onSetup={onSetup} />
            ) : (
              <div className="sky-places-no-location">
                <PlaceIcon name="pin" size={28} />
                <p>No map location yet</p>
                <Button onClick={onEdit}>Add a location</Button>
              </div>
            )}
          </div>
          <dl>
            {place.address && (
              <>
                <dt>Address</dt>
                <dd>{place.address}</dd>
              </>
            )}
            {place.parentRef && (
              <>
                <dt>Located in</dt>
                <dd>
                  <PlaceLink href={placeHref(place.parentRef)} navigate={navigate}>
                    {place.ancestors.at(-1)?.name || place.parentRef}
                  </PlaceLink>
                </dd>
              </>
            )}
            {place.site && /^https?:\/\//i.test(place.site) && (
              <>
                <dt>Website</dt>
                <dd>
                  <a href={place.site} target="_blank" rel="noreferrer">
                    {place.site.replace(/^https?:\/\//i, '')}
                    <PlaceIcon name="external" size={13} />
                  </a>
                </dd>
              </>
            )}
            {place.aliases.length > 0 && (
              <>
                <dt>Also known as</dt>
                <dd>{place.aliases.join(', ')}</dd>
              </>
            )}
            {place.coordinates && (
              <>
                <dt>Coordinates</dt>
                <dd className="sky-places-coordinates">
                  {place.coordinates.latitude.toFixed(5)}, {place.coordinates.longitude.toFixed(5)}
                </dd>
              </>
            )}
          </dl>
          <PlaceLink href={fileHref(place.id)} navigate={navigate} className="sky-places-source">
            <PlaceIcon name="document" size={16} />
            Open notebook file <PlaceIcon name="external" size={13} />
          </PlaceLink>
        </aside>
      </div>
    </>
  )
}
