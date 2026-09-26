import './people.css'
import { Button, Modal, Select, Textarea, TextInput } from '@mantine/core'
import { type Key, type MouseEvent, type ReactNode, useCallback, useEffect, useState } from 'react'
import type { LinkedInImport } from '#lib/linkedin/types.ts'
import {
  profileHref,
  type PeopleIndex,
  type ProfileDetail,
  type ProfileSummary,
  type ProfileType,
} from '../../people/types.ts'
import { fileHref } from './explorer.tsx'
import { peopleApi } from './peopleApi.ts'
import { PeopleEditor } from './peopleEditor.tsx'
import { ReferencesDialog, RenameFileLink, SpellingsNotice } from './peopleReferences.tsx'
import { RenderedHtml } from './renderedHtml.tsx'

interface PeopleRoute {
  type: ProfileType
  slug: string
}
export function peopleRouteOf(path: string): PeopleRoute | null {
  const match = /^\/(people|orgs)(?:\/(.*))?$/.exec(path)
  if (!match) return null
  try {
    return { type: match[1] === 'people' ? 'person' : 'org', slug: decodeURIComponent(match[2] ?? '') }
  } catch {
    return { type: match[1] === 'people' ? 'person' : 'org', slug: match[2] ?? '' }
  }
}

function AppLink({
  href,
  navigate,
  children,
  className,
}: {
  href: string
  navigate: (path: string) => void
  children: ReactNode
  className?: string
}) {
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    navigate(href)
  }
  return (
    <a href={href} className={className} onClick={open}>
      {children}
    </a>
  )
}

function Avatar({ profile, large = false }: { profile: Pick<ProfileSummary, 'type' | 'name'>; large?: boolean }) {
  return (
    <span className="sky-people-avatar" data-large={large} data-kind={profile.type} aria-hidden="true">
      {profile.type === 'person' ? (
        profile.name
          .split(/\s+/)
          .filter(Boolean)
          .map((word) => word[0])
          .slice(0, 2)
          .join('')
          .toUpperCase()
      ) : (
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M4 21V4h11v17M15 10h5v11M1 21h22M8 8h3M8 12h3M8 16h3" />
        </svg>
      )}
    </span>
  )
}
const orgLabel = (profile: ProfileSummary) =>
  profile.kind === 'unknown'
    ? profile.sector
    : [profile.kind[0].toUpperCase() + profile.kind.slice(1), profile.sector].filter(Boolean).join(' · ')
const personLabel = (profile: ProfileSummary) =>
  [profile.title, profile.current.map((org) => org.name).join(', ')].filter(Boolean).join(' · ')

function ProfileRow({
  profile,
  navigate,
}: {
  key?: Key | null
  profile: ProfileSummary
  navigate: (path: string) => void
}) {
  return (
    <AppLink href={profileHref(profile)} navigate={navigate} className="sky-people-row">
      <Avatar profile={profile} />
      <span className="sky-people-row-text">
        <strong>{profile.name || 'Unnamed profile'}</strong>
        <span>{profile.type === 'person' ? personLabel(profile) : orgLabel(profile)}</span>
      </span>
      <span className="sky-people-row-date">
        {profile.lastInteraction ? (
          <time dateTime={profile.lastInteraction}>{profile.lastInteraction.slice(0, 10)}</time>
        ) : (
          '—'
        )}
      </span>
      <span className="sky-people-row-arrow" aria-hidden="true">
        ›
      </span>
    </AppLink>
  )
}

function ProfilePage({
  profile,
  navigate,
  edit,
  addNote,
  updateReferences,
}: {
  profile: ProfileDetail
  navigate: (path: string) => void
  edit: () => void
  addNote: () => void
  updateReferences: () => void
}) {
  const emails = [...new Set([...profile.emailBusiness, ...profile.emailPersonal])]
  const hasDetails = Boolean(
    emails.length ||
    profile.sites.length ||
    profile.location ||
    profile.met ||
    profile.aliases.length ||
    profile.current.length ||
    profile.past.length ||
    profile.tags.length,
  )
  const orgs = (values: ProfileDetail['current']) =>
    values.map((org, index) => (
      <li key={`${org.name}-${index}`}>
        {org.slug ? (
          <AppLink href={profileHref({ type: 'org', slug: org.slug })} navigate={navigate}>
            {org.name}
          </AppLink>
        ) : (
          org.name
        )}
      </li>
    ))
  return (
    <>
      <div className="sky-people-breadcrumb">
        <AppLink href={profile.type === 'person' ? '/people' : '/orgs'} navigate={navigate}>
          ‹ {profile.type === 'person' ? 'People' : 'Organizations'}
        </AppLink>
      </div>
      <header className="sky-people-profile-header">
        <Avatar profile={profile} large />
        <div>
          <h1>{profile.name || 'Unnamed profile'}</h1>
          <p>{profile.type === 'person' ? profile.title : orgLabel(profile)}</p>
          <SpellingsNotice profile={profile} open={updateReferences} />
          {profile.type === 'person' && profile.current.length > 0 && (
            <ul className="sky-people-inline-orgs">{orgs(profile.current)}</ul>
          )}
          {emails[0] && (
            <a className="sky-people-contact" href={`mailto:${emails[0]}`}>
              {emails[0]}
            </a>
          )}
        </div>
        <span className="sky-people-profile-actions">
          <Button onClick={addNote}>Add note</Button>
          <Button onClick={edit}>Edit</Button>
        </span>
      </header>
      <div className="sky-people-profile-columns">
        <div className="sky-people-profile-content">
          {profile.html && (
            <section>
              {!/^<h[1-6]\b/.test(profile.html) && <h2>{profile.type === 'person' ? 'Notes' : 'Overview'}</h2>}
              <RenderedHtml html={profile.html} className="sky-people-prose" />
            </section>
          )}
          {profile.type === 'org' && profile.people.length > 0 && (
            <section>
              <h2>
                People <span className="sky-people-count">{profile.people.length}</span>
              </h2>
              {profile.people.map((person) => (
                <ProfileRow key={person.id} profile={person} navigate={navigate} />
              ))}
            </section>
          )}
          {profile.activity.length > 0 && (
            <section>
              <h2>Recent activity</h2>
              <ul className="sky-people-activity">
                {profile.activity.map((item) => (
                  <li key={item.path}>
                    <AppLink href={fileHref(item.path)} navigate={navigate}>
                      {item.label}
                    </AppLink>
                    {item.date && <time dateTime={item.date}>{item.date.slice(0, 10)}</time>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
        <aside className="sky-people-details" aria-label="Profile details">
          {hasDetails && <h2>Details</h2>}
          <dl>
            {emails.length > 0 && (
              <>
                <dt>Email</dt>
                <dd>
                  {emails.map((email) => (
                    <a key={email} href={`mailto:${email}`}>
                      {email}
                    </a>
                  ))}
                </dd>
              </>
            )}
            {profile.sites.length > 0 && (
              <>
                <dt>Links</dt>
                <dd>
                  {profile.sites.map((site) =>
                    /^https?:\/\//i.test(site) ? (
                      <a key={site} href={site} target="_blank" rel="noreferrer">
                        {site.replace(/^https?:\/\/(?:www\.)?/, '').replace(/\/$/, '')}
                      </a>
                    ) : (
                      <span key={site}>{site}</span>
                    ),
                  )}
                </dd>
              </>
            )}
            {profile.location && (
              <>
                <dt>Location</dt>
                <dd>{profile.location}</dd>
              </>
            )}
            {profile.met && (
              <>
                <dt>First met</dt>
                <dd>{profile.met}</dd>
              </>
            )}
            {profile.aliases.length > 0 && (
              <>
                <dt>Also known as</dt>
                <dd>{profile.aliases.join(', ')}</dd>
              </>
            )}
          </dl>
          {profile.current.length > 0 && (
            <section>
              <h3>Current organizations</h3>
              <ul>{orgs(profile.current)}</ul>
            </section>
          )}
          {profile.past.length > 0 && (
            <section>
              <h3>Past organizations</h3>
              <ul>{orgs(profile.past)}</ul>
            </section>
          )}
          {profile.tags.length > 0 && (
            <section>
              <h3>Tags</h3>
              <div className="sky-people-tags">
                {profile.tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
            </section>
          )}
          <AppLink href={fileHref(profile.id)} navigate={navigate} className="sky-people-source">
            Open notebook file ↗
          </AppLink>
          <RenameFileLink profile={profile} open={updateReferences} />
        </aside>
      </div>
    </>
  )
}

export function PeopleMain({
  route,
  navigate,
}: {
  key?: Key | null
  route: PeopleRoute
  navigate: (path: string) => void
}) {
  const [index, setIndex] = useState<PeopleIndex | null>(null)
  const [profile, setProfile] = useState<ProfileDetail | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<string | null>(null)
  const [sort, setSort] = useState<string | null>('name')
  const [editing, setEditing] = useState(false)
  const [job, setJob] = useState<LinkedInImport | undefined>()
  const [resume, setResume] = useState<LinkedInImport | undefined>()
  const [noteOpen, setNoteOpen] = useState(false)
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [referencesOpen, setReferencesOpen] = useState(false)
  /** The name a save just replaced, which the references dialog starts with */
  const [replaced, setReplaced] = useState<string>()
  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const [next, detail] = await Promise.all([
          peopleApi<PeopleIndex>('', undefined, signal),
          route.slug
            ? peopleApi<ProfileDetail>(
                `/profile?type=${route.type}&slug=${encodeURIComponent(route.slug)}`,
                undefined,
                signal,
              )
            : Promise.resolve(null),
        ])
        setIndex(next)
        setProfile(detail)
        setError('')
      } catch (error) {
        if (!signal?.aborted) setError(error instanceof Error ? error.message : 'Could not load your profiles.')
      }
    },
    [route.type, route.slug],
  )
  useEffect(() => {
    const abort = new AbortController()
    void load(abort.signal)
    return () => abort.abort()
  }, [load])
  useEffect(() => {
    document.title = `sky · ${profile?.name || 'People & Orgs'}`
  }, [profile?.name])
  useEffect(() => {
    if (!index?.linkedInAvailable || editing) return
    const abort = new AbortController()
    const refreshImport = () => {
      void peopleApi<LinkedInImport | null>('/linkedin', undefined, abort.signal)
        .then((value) => {
          if (value && value.id !== sessionStorage.getItem('sky-people-import-handled') && value.status !== 'failed')
            setJob(value)
          else setJob(undefined)
        })
        .catch(() => {})
    }
    refreshImport()
    const timer = job?.status === 'running' ? setInterval(refreshImport, 3000) : undefined
    return () => {
      abort.abort()
      clearInterval(timer)
    }
  }, [index?.linkedInAvailable, editing, job?.status])
  useEffect(() => {
    if (editing || noteOpen || referencesOpen) return
    const abort = new AbortController()
    const refresh = () => {
      if (!document.hidden) void load(abort.signal)
    }
    window.addEventListener('focus', refresh)
    const timer = setInterval(refresh, 30_000)
    return () => {
      abort.abort()
      clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [load, editing, noteOpen, referencesOpen])
  const saved = (next: ProfileDetail) => {
    // A new name leaves the old one in other files: offer to update them, as a rename does
    if (profile && profile.id === next.id && profile.name !== next.name)
      if (next.renameFile || next.spellings.some((spelling) => spelling.name === profile.name)) {
        setReplaced(profile.name)
        setReferencesOpen(true)
      }
    setEditing(false)
    setResume(undefined)
    setJob(undefined)
    if (route.slug === next.slug) {
      setProfile(next)
      void load()
    } else navigate(profileHref(next))
  }
  const saveNote = async () => {
    if (!profile) return
    setSavingNote(true)
    setNoteError('')
    try {
      setProfile(
        await peopleApi<ProfileDetail>('/note', {
          type: profile.type,
          id: profile.id,
          revision: profile.revision,
          text: note,
        }),
      )
      setNoteOpen(false)
      setNote('')
    } catch (error) {
      setNoteError(error instanceof Error ? error.message : 'Could not save your note.')
    } finally {
      setSavingNote(false)
    }
  }
  const rows = index ? (route.type === 'person' ? index.people : index.orgs) : []
  const needle = query.trim().toLowerCase()
  const visible = rows
    .filter(
      (item) =>
        (!needle ||
          [
            item.name,
            ...item.aliases,
            item.title,
            item.location,
            ...item.sites,
            ...item.emailBusiness,
            ...item.emailPersonal,
            ...item.current.map((org) => org.name),
          ]
            .join(' ')
            .toLowerCase()
            .includes(needle)) &&
        (!filter || (route.type === 'person' ? item.current.some((org) => org.id === filter) : item.kind === filter)),
    )
    .sort((a, b) =>
      needle
        ? b.score - a.score || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
        : sort === 'recent'
          ? (b.lastInteraction ?? '').localeCompare(a.lastInteraction ?? '') || a.name.localeCompare(b.name)
          : a.name.localeCompare(b.name),
    )
  const filterOptions =
    route.type === 'person'
      ? (index?.orgs ?? [])
          .filter((org) => rows.some((person) => person.current.some((choice) => choice.id === org.id)))
          .map((org) => ({ value: org.id, label: org.name }))
      : [
          { value: 'company', label: 'Companies' },
          { value: 'nonprofit', label: 'Nonprofits' },
          { value: 'government', label: 'Government' },
          { value: 'unknown', label: 'Not specified' },
        ].filter((option) => rows.some((org) => org.kind === option.value))

  return (
    <main className="sky-main sky-people-main">
      {error && (
        <div className="sky-people-error" role="alert">
          {error}{' '}
          <Button
            onClick={() => {
              void load()
            }}
          >
            Try again
          </Button>
        </div>
      )}
      {!index && !error && (
        <p role="status" className="sky-people-muted">
          Loading People &amp; Orgs…
        </p>
      )}
      {index &&
        (route.slug ? (
          profile && (
            <ProfilePage
              profile={profile}
              navigate={navigate}
              edit={() => setEditing(true)}
              addNote={() => setNoteOpen(true)}
              updateReferences={() => setReferencesOpen(true)}
            />
          )
        ) : (
          <>
            <header className="sky-people-heading">
              <div>
                <h1>People &amp; Orgs</h1>
                <p>People, organizations, and your shared history.</p>
              </div>
              <Button variant="primary" onClick={() => setEditing(true)}>
                ＋ {route.type === 'person' ? 'Add person' : 'Add org'}
              </Button>
            </header>
            <nav className="sky-people-tabs" aria-label="People and organizations">
              <AppLink href="/people" navigate={navigate} className={route.type === 'person' ? 'active' : ''}>
                People <span>{index.people.length}</span>
              </AppLink>
              <AppLink href="/orgs" navigate={navigate} className={route.type === 'org' ? 'active' : ''}>
                Organizations <span>{index.orgs.length}</span>
              </AppLink>
            </nav>
            {job && (
              <div className="sky-people-resume">
                <span>
                  {job.status === 'running' ? 'A LinkedIn import is in progress.' : 'Your LinkedIn draft is ready.'}
                </span>
                <Button
                  onClick={() => {
                    setResume(job)
                    setEditing(true)
                  }}
                >
                  Open import
                </Button>
                <Button
                  size="compact-sm"
                  onClick={() => {
                    sessionStorage.setItem('sky-people-import-handled', job.id)
                    setJob(undefined)
                  }}
                >
                  Dismiss
                </Button>
              </div>
            )}
            {rows.length > 0 && (
              <div className="sky-people-tools">
                <TextInput
                  aria-label={route.type === 'person' ? 'Search people' : 'Search organizations'}
                  placeholder={route.type === 'person' ? 'Search people…' : 'Search organizations…'}
                  value={query}
                  onChange={(event) => setQuery(event.currentTarget.value)}
                />
                <Select
                  aria-label={route.type === 'person' ? 'Filter by organization' : 'Filter by type'}
                  placeholder={route.type === 'person' ? 'All organizations' : 'All types'}
                  value={filter}
                  clearable
                  searchable
                  onChange={setFilter}
                  data={filterOptions}
                  disabled={!filterOptions.length}
                />
                <Select
                  aria-label="Sort profiles"
                  value={needle ? 'score' : sort}
                  onChange={setSort}
                  disabled={Boolean(needle)}
                  data={
                    needle
                      ? [{ value: 'score', label: 'Most relevant' }]
                      : [
                          { value: 'name', label: 'Name A–Z' },
                          { value: 'recent', label: 'Last interaction' },
                        ]
                  }
                />
              </div>
            )}
            {visible.length ? (
              <div className="sky-people-list">
                <div className="sky-people-list-label">
                  <span>
                    {visible.length}{' '}
                    {route.type === 'person'
                      ? visible.length === 1
                        ? 'person'
                        : 'people'
                      : visible.length === 1
                        ? 'organization'
                        : 'organizations'}
                  </span>
                  <span>Last interaction</span>
                </div>
                {visible.map((item) => (
                  <ProfileRow key={item.id} profile={item} navigate={navigate} />
                ))}
              </div>
            ) : (
              <div className="sky-people-empty">
                <Avatar profile={{ type: route.type, name: '＋' }} large />
                <h2>
                  {rows.length
                    ? 'No matches'
                    : route.type === 'person'
                      ? 'Start with someone you know'
                      : 'Give your organizations a home'}
                </h2>
                <p>
                  {rows.length
                    ? 'Try another name or clear the filters.'
                    : route.type === 'person'
                      ? 'Add a name or start with a LinkedIn profile. Keep their context and your shared history together.'
                      : 'A name is enough to start. Add details and connect people as you go.'}
                </p>
                <Button
                  variant="primary"
                  onClick={() => {
                    if (rows.length) {
                      setQuery('')
                      setFilter(null)
                    } else setEditing(true)
                  }}
                >
                  {rows.length
                    ? 'Clear filters'
                    : route.type === 'person'
                      ? 'Add your first person'
                      : 'Add your first organization'}
                </Button>
              </div>
            )}
          </>
        ))}
      {editing && index && (
        <PeopleEditor
          type={resume ? 'person' : route.type}
          profile={resume ? undefined : (profile ?? undefined)}
          index={index}
          initialImport={resume}
          navigate={navigate}
          onClose={() => {
            setEditing(false)
            setResume(undefined)
            void load()
          }}
          onSaved={saved}
        />
      )}
      {profile && (
        <ReferencesDialog
          profile={profile}
          opened={referencesOpen}
          initial={replaced}
          onClose={() => {
            setReferencesOpen(false)
            setReplaced(undefined)
          }}
          onUpdated={() => {
            void load()
          }}
        />
      )}
      <Modal
        opened={noteOpen}
        onClose={() => {
          if (!savingNote) setNoteOpen(false)
        }}
        title={`Add a note${profile ? ` · ${profile.name}` : ''}`}
        size="lg"
        closeOnClickOutside={false}
      >
        <Textarea
          aria-label="Note"
          placeholder="What would you like to remember?"
          autosize
          minRows={5}
          value={note}
          onChange={(event) => setNote(event.currentTarget.value)}
        />
        {noteError && (
          <p role="alert" className="sky-people-error">
            {noteError}
          </p>
        )}
        <div className="sky-people-form-actions">
          <Button onClick={() => setNoteOpen(false)} disabled={savingNote}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              void saveNote()
            }}
            loading={savingNote}
            disabled={!note.trim()}
          >
            Save note
          </Button>
        </div>
      </Modal>
    </main>
  )
}
