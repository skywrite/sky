import { Button, Checkbox, Modal, Select, TagsInput, Textarea, TextInput } from '@mantine/core'
import { useEffect, useRef, useState } from 'react'
import { linkedInUrl, type LinkedInImport } from '#lib/linkedin/types.ts'
import {
  blankProfile,
  organizationMatches,
  organizationNeedsChoice,
  profileHref,
  type OrganizationChoice,
  type PeopleIndex,
  type ProfileDetail,
  type ProfileFields,
  type ProfileType,
} from '../../people/types.ts'
import { peopleApi } from './peopleApi.ts'

const errorText = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong. Try again.')
const plain = (value: string) => value.trim().toLowerCase()

/** The sites with a pasted LinkedIn URL added, unless one of them is already that profile. */
function withLinkedIn(sites: string[], url: string): string[] {
  const linkedIn = linkedInUrl(url)
  const same = (site: string) => {
    try {
      return plain(linkedInUrl(site)) === plain(linkedIn)
    } catch {
      return false
    }
  }
  return sites.some(same) ? sites : [...sites, linkedIn]
}

function OrganizationFields({
  label,
  value,
  orgs,
  onChange,
}: {
  label: string
  value: OrganizationChoice[]
  orgs: PeopleIndex['orgs']
  onChange: (value: OrganizationChoice[]) => void
}) {
  const [name, setName] = useState('')
  const add = () => {
    const typed = name.trim()
    if (typed && !value.some((choice) => plain(choice.name) === plain(typed))) onChange([...value, { name: typed }])
    setName('')
  }
  return (
    <fieldset className="sky-people-org-fields">
      <legend>{label}</legend>
      {value.map((choice, index) => {
        const matches = organizationMatches(choice, orgs)
        return (
          <div key={`${index}-${choice.name}`} className="sky-people-org-choice">
            <div>
              <strong>{choice.name}</strong>
              {organizationNeedsChoice(choice, orgs) ? (
                <Select
                  label={`Choose ${choice.name}`}
                  placeholder="Choose the organization"
                  value={null}
                  data={[
                    ...matches.map((org) => ({ value: org.id, label: `${org.name} · ${org.sites[0] || org.id}` })),
                    { value: '__create__', label: 'Create a separate organization' },
                  ]}
                  onChange={(id) =>
                    onChange(
                      value.map((item, at) =>
                        at === index
                          ? {
                              ...item,
                              id: id === '__create__' ? undefined : (id ?? undefined),
                              create: id === '__create__',
                            }
                          : item,
                      ),
                    )
                  }
                />
              ) : (
                <small>
                  {choice.id || matches.length === 1
                    ? 'Links to an existing organization'
                    : 'Creates an organization when you save'}
                </small>
              )}
            </div>
            <Button
              size="compact-sm"
              aria-label={`Remove ${choice.name}`}
              onClick={() => onChange(value.filter((_, at) => at !== index))}
            >
              Remove
            </Button>
          </div>
        )
      })}
      <div className="sky-people-org-add">
        <TextInput
          aria-label={`Add to ${label.toLowerCase()}`}
          placeholder="Organization name"
          value={name}
          list={`people-orgs-${label.replaceAll(' ', '-')}`}
          onChange={(event) => setName(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              add()
            }
          }}
          // A name typed but never added still counts, as Websites does
          onBlur={add}
        />
        <datalist id={`people-orgs-${label.replaceAll(' ', '-')}`}>
          {orgs.map((org) => (
            <option key={org.id} value={org.name} />
          ))}
        </datalist>
        <Button disabled={!name.trim()} onClick={add}>
          Add
        </Button>
      </div>
    </fieldset>
  )
}

export function PeopleEditor({
  type,
  profile,
  index,
  initialImport,
  onClose,
  onSaved,
  navigate,
}: {
  type: ProfileType
  profile?: ProfileDetail
  index: PeopleIndex
  initialImport?: LinkedInImport
  onClose: () => void
  onSaved: (profile: ProfileDetail) => void
  navigate: (path: string) => void
}) {
  const [draft, setDraft] = useState<ProfileFields>(() => (profile ? { ...profile } : blankProfile(type)))
  const [notes, setNotes] = useState('')
  const [url, setUrl] = useState(initialImport?.url ?? '')
  const [urlError, setUrlError] = useState('')
  const [job, setJob] = useState<LinkedInImport | undefined>(initialImport)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [importStarting, setImportStarting] = useState(false)
  const [more, setMore] = useState(Boolean(profile))
  const [namesake, setNamesake] = useState(false)
  const [discard, setDiscard] = useState(false)
  const [leaveFor, setLeaveFor] = useState<string | null>(null)
  const applied = useRef<string | null>(null)
  const initial = useRef(JSON.stringify(draft))
  const set = <K extends keyof ProfileFields>(key: K, value: ProfileFields[K]) => {
    setDraft((old) => ({ ...old, [key]: value }))
    setDiscard(false)
  }
  const running = job?.status === 'running'
  const duplicates = (type === 'person' ? index.people : index.orgs).filter(
    (item) => item.id !== profile?.id && plain(item.name) === plain(draft.name),
  )
  const ambiguous = [...draft.current, ...draft.past].some((choice) => organizationNeedsChoice(choice, index.orgs))
  const dirty = initial.current !== JSON.stringify(draft) || Boolean(notes.trim())

  useEffect(() => {
    if (!running) return
    let stopped = false
    const abort = new AbortController()
    const poll = async () => {
      try {
        const next = await peopleApi<LinkedInImport | null>('/linkedin', undefined, abort.signal)
        if (!stopped && next?.id === job.id) {
          setJob(next)
          setError('')
        }
      } catch (error) {
        if (!stopped) setError(errorText(error))
      }
    }
    const timer = setInterval(() => {
      void poll()
    }, 1200)
    void poll()
    return () => {
      stopped = true
      abort.abort()
      clearInterval(timer)
    }
  }, [running, job?.id])

  useEffect(() => {
    if (job?.status !== 'complete' || !job.draft || applied.current === job.id) return
    applied.current = job.id
    const imported = job.draft
    const choices = (values: OrganizationChoice[]) =>
      values.map((choice) => {
        const named = organizationMatches(choice, index.orgs)
        return named.length === 1 && !organizationNeedsChoice(choice, index.orgs)
          ? { ...choice, name: named[0].name, id: named[0].id }
          : choice
      })
    setDraft((old) => ({
      ...old,
      name: old.name || imported.name,
      title: old.title || imported.title,
      location: old.location || imported.location,
      sites: [...new Set([...old.sites, imported.url])],
      current: old.current.length ? old.current : choices(imported.current),
      past: old.past.length ? old.past : choices(imported.past),
    }))
    setNotes((old) => [old, imported.about, `Source: [LinkedIn](${imported.url})`].filter(Boolean).join('\n\n'))
    setNotice(imported.warning || 'The profile is ready to review. Edit anything before saving.')
    setMore(true)
  }, [job, index.orgs])

  const close = () => {
    if (busy) return
    if (dirty && !discard) {
      setDiscard(true)
      return
    }
    onClose()
  }
  const discardDraft = () => {
    onClose()
    if (leaveFor) navigate(leaveFor)
  }
  const startImport = async () => {
    setImportStarting(true)
    setError('')
    setNotice('')
    try {
      setJob(await peopleApi<LinkedInImport>('/linkedin', { url }))
    } catch (error) {
      setError(errorText(error))
    } finally {
      setImportStarting(false)
    }
  }
  const save = async () => {
    // A pasted LinkedIn URL is kept even when it was never imported
    let sites = draft.sites
    if (!profile && type === 'person' && url.trim()) {
      try {
        sites = withLinkedIn(draft.sites, url)
      } catch (error) {
        setUrlError(errorText(error))
        return
      }
    }
    setBusy(true)
    setError('')
    try {
      const saved = await peopleApi<ProfileDetail>('/profile', {
        ...draft,
        sites,
        id: profile?.id,
        revision: profile?.revision,
        notes: profile ? undefined : notes,
        allowNamesake: namesake,
      })
      if (job) sessionStorage.setItem('sky-people-import-handled', job.id)
      onSaved(saved)
    } catch (error) {
      setError(errorText(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      opened
      onClose={close}
      title={`${profile ? 'Edit' : 'Add'} ${type === 'person' ? 'person' : 'organization'}`}
      size="lg"
      closeOnClickOutside={false}
    >
      <form
        className="sky-people-form"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        {!profile && type === 'person' && index.linkedInAvailable && (
          <div className="sky-people-import">
            <TextInput
              label="Start with LinkedIn"
              placeholder="https://www.linkedin.com/in/…"
              value={url}
              onChange={(event) => {
                setUrl(event.currentTarget.value)
                setUrlError('')
              }}
              error={urlError}
              disabled={running || importStarting}
            />
            <Button
              variant="primary-quiet"
              onClick={() => {
                void startImport()
              }}
              disabled={!url.trim() || running}
              loading={importStarting}
            >
              Import profile
            </Button>
            <p>Sky opens a browser for you to sign in. You’ll review the details here before saving.</p>
            {running && (
              <div role="status">
                <p>{job.stage}</p>
                <Button
                  size="compact-sm"
                  onClick={() => {
                    void peopleApi('/linkedin/cancel', { id: job.id }).catch((error) => setError(errorText(error)))
                  }}
                >
                  Cancel import
                </Button>
              </div>
            )}
            {job?.status === 'failed' && <p role="alert">{job.error} You can still add this person manually.</p>}
          </div>
        )}
        {notice && (
          <p className="sky-people-notice" role="status">
            {notice}
          </p>
        )}
        <TextInput
          label="Name"
          placeholder={type === 'person' ? 'Full name' : 'Organization name'}
          required
          autoFocus
          value={draft.name}
          onChange={(event) => set('name', event.currentTarget.value)}
          maxLength={300}
        />
        {duplicates.length > 0 && (
          <div className="sky-people-duplicates">
            <p>Already in your notebook:</p>
            {duplicates.map((item) => (
              <a
                key={item.id}
                href={profileHref(item)}
                onClick={(event) => {
                  if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
                  event.preventDefault()
                  if (!dirty || discard) {
                    onClose()
                    navigate(profileHref(item))
                  } else {
                    setLeaveFor(profileHref(item))
                    setDiscard(true)
                  }
                }}
              >
                {item.name} · {item.title || item.sites[0] || item.id}
              </a>
            ))}
            <Checkbox
              label={`This is a different ${type === 'person' ? 'person' : 'organization'} with the same name`}
              checked={namesake}
              onChange={(event) => setNamesake(event.currentTarget.checked)}
            />
          </div>
        )}
        {type === 'person' ? (
          <>
            <TextInput
              label="Role"
              placeholder="What they do"
              value={draft.title}
              onChange={(event) => set('title', event.currentTarget.value)}
            />
            <OrganizationFields
              label="Current organizations"
              value={draft.current}
              orgs={index.orgs}
              onChange={(value) => set('current', value)}
            />
            <TagsInput
              label="Email"
              placeholder="Add an email address"
              value={draft.emailBusiness}
              onChange={(value) => set('emailBusiness', value)}
              splitChars={[',', ';']}
            />
          </>
        ) : (
          <>
            <TagsInput
              label="Websites"
              placeholder="https://example.com"
              value={draft.sites}
              onChange={(value) => set('sites', value)}
              splitChars={[';']}
            />
            <Select
              label="Type"
              value={draft.kind}
              onChange={(value) => set('kind', (value ?? 'unknown') as ProfileFields['kind'])}
              data={[
                { value: 'unknown', label: 'Not specified' },
                { value: 'company', label: 'Company' },
                { value: 'nonprofit', label: 'Nonprofit' },
                { value: 'government', label: 'Government' },
              ]}
            />
          </>
        )}
        {!profile && (
          <Textarea
            label={type === 'person' ? 'Notes' : 'About'}
            placeholder={type === 'person' ? 'Anything you want to remember…' : 'What does this organization do?'}
            autosize
            minRows={3}
            maxRows={12}
            value={notes}
            onChange={(event) => setNotes(event.currentTarget.value)}
          />
        )}
        <button type="button" className="sky-people-more" aria-expanded={more} onClick={() => setMore(!more)}>
          {more ? 'Fewer details' : 'More details'}
        </button>
        {more && (
          <>
            <TextInput
              label="Location"
              value={draft.location}
              onChange={(event) => set('location', event.currentTarget.value)}
            />
            <TagsInput
              label="Also known as"
              value={draft.aliases}
              onChange={(value) => set('aliases', value)}
              splitChars={[';']}
            />
            {type === 'person' ? (
              <>
                <TagsInput
                  label="Personal email"
                  value={draft.emailPersonal}
                  onChange={(value) => set('emailPersonal', value)}
                  splitChars={[',', ';']}
                />
                <TagsInput
                  label="Websites"
                  value={draft.sites}
                  onChange={(value) => set('sites', value)}
                  splitChars={[';']}
                />
                <TextInput
                  label="First met"
                  placeholder="YYYY-MM-DD"
                  description="A year or year and month is fine too."
                  value={draft.met === 'Never' ? '' : draft.met}
                  disabled={draft.met === 'Never'}
                  onChange={(event) => set('met', event.currentTarget.value)}
                />
                <Checkbox
                  label="Never met"
                  checked={draft.met === 'Never'}
                  onChange={(event) => set('met', event.currentTarget.checked ? 'Never' : '')}
                />
                <OrganizationFields
                  label="Past organizations"
                  value={draft.past}
                  orgs={index.orgs}
                  onChange={(value) => set('past', value)}
                />
              </>
            ) : (
              <TextInput
                label="Sector"
                value={draft.sector}
                onChange={(event) => set('sector', event.currentTarget.value)}
              />
            )}
          </>
        )}
        {error && (
          <p role="alert" className="sky-people-error">
            {error}
          </p>
        )}
        <div className="sky-people-form-actions">
          {discard ? (
            <>
              <span>Discard your changes?</span>
              <Button
                onClick={() => {
                  setDiscard(false)
                  setLeaveFor(null)
                }}
              >
                Keep editing
              </Button>
              <Button variant="danger" onClick={discardDraft}>
                Discard
              </Button>
            </>
          ) : (
            <>
              <Button onClick={close} disabled={busy}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                loading={busy}
                disabled={
                  running || importStarting || !draft.name.trim() || (duplicates.length > 0 && !namesake) || ambiguous
                }
              >
                {profile ? 'Save changes' : type === 'person' ? 'Add person' : 'Add org'}
              </Button>
            </>
          )}
        </div>
      </form>
    </Modal>
  )
}
