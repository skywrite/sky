import { ActionIcon, Button, Loader, TextInput } from '@mantine/core'
import { useEffect, useRef, useState } from 'react'
import type { CalendarInvitee, CalendarContact } from '#lib/calendarScheduler/types.ts'

const isEmail = (value: string) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value)

function Candidates({
  people,
  choose,
}: {
  people: CalendarContact[]
  choose: (person: CalendarContact, email: string) => void
}) {
  return (
    <div className="sky-meeting-candidates">
      {people.map((person) => (
        <div className="sky-meeting-candidate" key={person.id} role="group" aria-label={person.name}>
          {person.emails.length > 1 ? (
            <>
              <div className="sky-meeting-person sky-meeting-candidate-profile">
                <span className="sky-meeting-avatar" aria-hidden="true">
                  {person.name.slice(0, 1).toUpperCase()}
                </span>
                <span>
                  <strong>{person.name}</strong>
                  {person.hint && <small>{person.hint}</small>}
                </span>
              </div>
              <div className="sky-meeting-email-options">
                <p>Choose one email for the invitation</p>
                {person.emails.map((email) => (
                  <button
                    type="button"
                    key={email}
                    aria-label={`Use ${email} for ${person.name}`}
                    onClick={() => choose(person, email)}
                  >
                    <span className="sky-meeting-email-choice" aria-hidden="true" />
                    <span>{email}</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <button type="button" onClick={() => choose(person, person.emails[0] ?? '')}>
              <span className="sky-meeting-avatar" aria-hidden="true">
                {person.name.slice(0, 1).toUpperCase()}
              </span>
              <span>
                <strong>{person.name}</strong>
                <small>
                  {person.emails[0] || 'No email saved'}
                  {person.hint && ` · ${person.hint}`}
                </small>
              </span>
              <span aria-hidden="true">＋</span>
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

function Unresolved({ invitee, onChange }: { invitee: CalendarInvitee; onChange: (invitee: CalendarInvitee) => void }) {
  const [email, setEmail] = useState('')
  const emailInput = useRef<HTMLInputElement>(null)
  const person = invitee.candidates.find((candidate) => candidate.id === invitee.personId)
  const personId = person?.id
  const name = person?.name ?? invitee.query
  useEffect(() => {
    if (personId) emailInput.current?.focus()
  }, [personId])
  const confirmEmail = () => onChange({ ...invitee, selected: { name, email: email.trim() } })
  return (
    <div className="sky-meeting-unresolved">
      {person ? (
        <div className="sky-meeting-person">
          <span className="sky-meeting-avatar" aria-hidden="true">
            {person.name.slice(0, 1).toUpperCase()}
          </span>
          <span>
            <strong>{person.name}</strong>
            <small>No email saved — add one below</small>
          </span>
          <Button
            size="compact-sm"
            onClick={() => {
              setEmail('')
              onChange({ ...invitee, personId: undefined })
            }}
          >
            Change
          </Button>
        </div>
      ) : (
        <>
          {invitee.candidates.length > 1 && <p>Who do you mean by “{invitee.query}”?</p>}
          {!invitee.candidates.length && <p>Add an email for {invitee.query}</p>}
          <Candidates
            people={invitee.candidates}
            choose={(candidate, address) => {
              setEmail('')
              onChange({
                ...invitee,
                personId: candidate.id,
                selected: address ? { name: candidate.name, email: address } : null,
              })
              if (!address) emailInput.current?.focus()
            }}
          />
        </>
      )}
      <div className="sky-meeting-email">
        <TextInput
          ref={emailInput}
          type="email"
          aria-label={`Email for ${name}`}
          placeholder="Enter an email address"
          value={email}
          onChange={(event) => setEmail(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && isEmail(email.trim())) {
              event.preventDefault()
              confirmEmail()
            }
          }}
        />
        <Button size="sm" disabled={!isEmail(email.trim())} onClick={confirmEmail}>
          Use email
        </Button>
      </div>
    </div>
  )
}

export function MeetingGuests({
  value,
  onChange,
}: {
  value: CalendarInvitee[]
  onChange: (value: CalendarInvitee[]) => void
}) {
  const [query, setQuery] = useState('')
  const [people, setPeople] = useState<CalendarContact[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    setPeople([])
    setError('')
    if (!query.trim() || isEmail(query.trim())) {
      setBusy(false)
      return
    }
    const controller = new AbortController()
    setBusy(true)
    const timer = setTimeout(() => {
      fetch(`/meetings/_api/people?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error('Contact search is unavailable. You can enter an email address.')
          const result = (await response.json()) as CalendarContact[]
          if (!controller.signal.aborted) setPeople(result)
        })
        .catch((failure: unknown) => {
          if (!controller.signal.aborted)
            setError(failure instanceof Error ? failure.message : 'Could not search contacts.')
        })
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false)
        })
    }, 200)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  const add = (items: CalendarInvitee[]) => {
    const existing = new Set(value.flatMap((item) => (item.selected ? [item.selected.email.toLowerCase()] : [])))
    const fresh = items.filter((item) => {
      const email = item.selected?.email.toLowerCase()
      if (!email) return true
      if (existing.has(email)) return false
      existing.add(email)
      return true
    })
    onChange([...value, ...fresh])
    setQuery('')
    setPeople([])
  }
  const addresses = query.split(/[,;\s]+/).filter(Boolean)
  const emailsReady = addresses.length > 0 && addresses.every(isEmail)
  const addEmails = () =>
    add(addresses.map((email) => ({ query: email, candidates: [], selected: { name: email, email } })))

  return (
    <section className="sky-meeting-guests" aria-label="Invitees">
      <div className="sky-meeting-section-label">
        Invitees <span>{value.length}</span>
      </div>
      <div className="sky-meeting-guest-list">
        {value.map((invitee, index) => (
          <div
            key={`${index}:${invitee.query}`}
            className="sky-meeting-guest"
            data-unresolved={!invitee.selected || undefined}
          >
            {invitee.selected ? (
              <div className="sky-meeting-person">
                <span className="sky-meeting-avatar" aria-hidden="true">
                  {invitee.selected.name.slice(0, 1).toUpperCase()}
                </span>
                <span>
                  <strong>{invitee.selected.name}</strong>
                  <small>{invitee.selected.email}</small>
                </span>
                <Button
                  size="compact-sm"
                  onClick={() =>
                    onChange(
                      value.map((item, i) => (i === index ? { ...item, personId: undefined, selected: null } : item)),
                    )
                  }
                >
                  Change
                </Button>
              </div>
            ) : (
              <Unresolved
                invitee={invitee}
                onChange={(next) => onChange(value.map((item, i) => (i === index ? next : item)))}
              />
            )}
            <ActionIcon
              size="sm"
              aria-label={`Remove ${invitee.selected?.name ?? invitee.query}`}
              onClick={() => onChange(value.filter((_, i) => i !== index))}
            >
              ×
            </ActionIcon>
          </div>
        ))}
      </div>
      <div className="sky-meeting-email">
        <TextInput
          aria-label="Add invitees"
          placeholder="Add a name or email…"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && emailsReady) {
              event.preventDefault()
              addEmails()
            }
          }}
          rightSection={busy ? <Loader size="xs" /> : undefined}
        />
        {emailsReady && (
          <Button size="sm" onClick={addEmails}>
            Add
          </Button>
        )}
      </div>
      {query.trim() && !emailsReady && (
        <Candidates
          people={people}
          choose={(person, email) =>
            add([
              {
                query: person.name,
                candidates: [person],
                personId: person.id,
                selected: email ? { name: person.name, email } : null,
              },
            ])
          }
        />
      )}
      {error && (
        <p className="sky-meeting-note" role="status">
          {error}
        </p>
      )}
      {query.trim() && !emailsReady && !busy && !people.length && !error && (
        <p className="sky-meeting-note">No matching contact. Enter an email address to invite someone new.</p>
      )}
    </section>
  )
}
