import { Button, Input, TextInput } from '@mantine/core'
import { useEffect, useState } from 'react'
import type { AboutMeInput, AboutMeProfile, AboutMeSuggestion } from '../../../service/handler/settings/aboutMe.ts'
import { MarkdownField } from '../editor/markdownEditor.tsx'
import { Block, UNREACHABLE } from './settingsBlocks.tsx'

interface Draft {
  saved: AboutMeProfile
  name: string
  text: string
  links: string[]
}
let draft: Draft | null = null
let learnedProfile: AboutMeSuggestion | null = null
// Each suggestion mounts a fresh editor; the editor reads its text only when it mounts.
let learnedVersion = 0
const MAX_TEXT = 80_000
const fields = (value: Draft): AboutMeInput => ({
  name: value.name,
  text: value.text,
  links: value.links.map((link) => link.trim()).filter(Boolean),
})
const changed = (value: Draft) =>
  JSON.stringify(fields(value)) !==
  JSON.stringify({ name: value.saved.name, text: value.saved.text, links: value.saved.links })
// The editor ends a document typed from scratch with a newline; the profile is stored without one, as before.
const body = (markdown: string) => markdown.replace(/\n+$/, '')
const message = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong. Please try again.')

async function request<T>(suffix: string, input?: unknown, method = 'PUT'): Promise<T> {
  const response = await fetch(
    `/settings/_api/about-me${suffix}`,
    input === undefined
      ? undefined
      : {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        },
  ).catch(() => null)
  if (!response) throw new Error(UNREACHABLE)
  const data = (await response.json()) as T & { message?: string }
  if (!response.ok) throw new Error(data.message ?? 'Your profile could not be loaded.')
  return data
}

export function useAboutMeDraftGuard() {
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if ((draft && changed(draft)) || learnedProfile) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])
}

export function AboutMePane({ memoryNotes }: { memoryNotes: number }) {
  const [value, setValue] = useState<Draft | null>(draft)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState<'save' | 'learn' | null>(null)
  const [suggestion, showSuggestion] = useState<AboutMeSuggestion | null>(learnedProfile)
  const setSuggestion = (next: AboutMeSuggestion | null) => {
    learnedProfile = next
    showSuggestion(next)
  }
  const [loaded, setLoaded] = useState(false)
  const [conflict, setConflict] = useState(false)
  // Replacing the profile text (a reload, a suggestion, a save) remounts the editor with it.
  const [editorKey, setEditorKey] = useState(0)
  const update = (next: Draft) => {
    draft = next
    setValue(next)
    setNotice('')
  }
  const load = async (replace = false, clearError = true) => {
    try {
      const saved = await request<AboutMeProfile>('')
      if (!draft || replace || !changed(draft)) {
        if (draft && draft.text !== saved.text) setEditorKey((key) => key + 1)
        draft = { saved, name: saved.name, text: saved.text, links: saved.links.length ? saved.links : [''] }
        setValue(draft)
        setConflict(false)
      } else setConflict(draft.saved.revision !== saved.revision)
      if (clearError) setError('')
    } catch (problem) {
      setError(message(problem))
    } finally {
      setLoaded(true)
    }
  }
  useEffect(() => {
    void load()
  }, [])
  if (!value)
    return (
      <div role="status" className="sky-set-note">
        {error || 'Loading your profile…'}
        {error && <Button onClick={() => void load()}>Try again</Button>}
      </div>
    )
  const input = fields(value)
  const invalidLink = value.links.find((link) => {
    if (!link.trim()) return false
    try {
      const url = new URL(link.trim())
      return !['http:', 'https:'].includes(url.protocol) || !!url.username || !!url.password
    } catch {
      return true
    }
  })
  const tooLong = value.text.length > MAX_TEXT
  const save = async () => {
    setBusy('save')
    setError('')
    setNotice('')
    try {
      const saved = await request<AboutMeProfile>('', { ...input, revision: value.saved.revision })
      if (saved.text !== value.text) setEditorKey((key) => key + 1)
      update({ saved, name: saved.name, text: saved.text, links: saved.links.length ? saved.links : [''] })
      setNotice('Saved. Sky will use this context in new conversations.')
      setConflict(false)
    } catch (problem) {
      setError(message(problem))
      void load(false, false)
    } finally {
      setBusy(null)
    }
  }
  const learn = async () => {
    setBusy('learn')
    setError('')
    setSuggestion(null)
    try {
      const learned = await request<AboutMeSuggestion>('/learn', input, 'POST')
      learnedVersion += 1
      setSuggestion(learned)
    } catch (problem) {
      setError(message(problem))
    } finally {
      setBusy(null)
    }
  }
  return (
    <>
      {error && (
        <p className="sky-set-warn" role="alert">
          {error}
        </p>
      )}
      {conflict && (
        <div className="sky-set-conflict" role="status">
          <p>Your saved profile changed elsewhere. Your edits are still here.</p>
          <Button onClick={() => void load(true)}>Load saved profile</Button>
        </div>
      )}
      <Block
        head="Tell Sky about yourself"
        note="Your background, responsibilities, goals, and anything else you’d like Sky to know."
      >
        <div className="sky-set-profile-fields">
          <TextInput
            label="Your name"
            placeholder="What should Sky call you?"
            value={value.name}
            maxLength={200}
            disabled={!!busy}
            onChange={(event) => update({ ...value, name: event.currentTarget.value })}
          />
          <Input.Wrapper label="About you" labelElement="div">
            <MarkdownField
              key={editorKey}
              className="sky-set-profile-editor"
              initial={value.text}
              label="About you"
              hint={value.text.trim() ? undefined : 'Start anywhere. What matters to you right now?'}
              disabled={!!busy}
              onChange={(text) => update({ ...value, text: body(text) })}
            />
          </Input.Wrapper>
          {tooLong && (
            <p className="sky-set-warn" role="status">
              Your profile is over 80,000 characters. Shorten it to save.
            </p>
          )}
          <p className="sky-set-note">A few sentences are enough to begin. You can add more as life changes.</p>
        </div>
      </Block>
      <Block
        head="Help Sky get to know you"
        note="Add your website, bio, blog, or social profiles. Sky can read the accessible pages and suggest an About me profile."
      >
        <div className="sky-set-profile-links">
          {value.links.map((link, index) => (
            <div className="sky-set-profile-link" key={index}>
              <TextInput
                aria-label={`Profile link ${index + 1}`}
                type="url"
                placeholder="https://example.com/about"
                value={link}
                disabled={!!busy}
                maxLength={2048}
                onChange={(event) =>
                  update({
                    ...value,
                    links: value.links.map((item, at) => (at === index ? event.currentTarget.value : item)),
                  })
                }
              />
              <Button
                size="compact-sm"
                aria-label={`Remove profile link ${index + 1}`}
                disabled={!!busy}
                onClick={() =>
                  update({
                    ...value,
                    links: value.links.length === 1 ? [''] : value.links.filter((_, at) => at !== index),
                  })
                }
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
        {invalidLink && (
          <p className="sky-set-warn" role="status">
            Use a full website link beginning with https://.
          </p>
        )}
        <div className="sky-set-actions">
          <Button
            disabled={!!busy || value.links.length >= 8}
            onClick={() => update({ ...value, links: [...value.links, ''] })}
          >
            ＋ Add link
          </Button>
          <Button
            variant="primary"
            loading={busy === 'learn'}
            disabled={!!busy || !!invalidLink || tooLong || !input.links.length || !loaded}
            onClick={() => void learn()}
          >
            Learn about me
          </Button>
        </div>
        <p className="sky-set-note">
          You’ll be able to edit the suggestion before saving. You can also paste a bio above.
        </p>
      </Block>
      {suggestion && (
        <Block head="What Sky learned" note="Review this suggestion and make it your own.">
          <Input.Wrapper label="Suggested profile" labelElement="div">
            <MarkdownField
              key={learnedVersion}
              className="sky-set-profile-editor"
              initial={suggestion.text}
              label="Suggested profile"
              onChange={(text) => setSuggestion({ ...suggestion, text: body(text) })}
            />
          </Input.Wrapper>
          <ul className="sky-set-sources">
            {suggestion.sources.map((source) => (
              <li key={source.url}>
                <a href={source.url} target="_blank" rel="noreferrer">
                  {new URL(source.url).hostname}
                </a>
                {source.error && <span> — {source.error}</span>}
              </li>
            ))}
          </ul>
          {!!suggestion.questions.length && (
            <div className="sky-set-followups">
              <p>A few things you could add:</p>
              <ul>
                {suggestion.questions.map((question) => (
                  <li key={question}>{question}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="sky-set-actions">
            <Button
              variant="primary"
              onClick={() => {
                update({ ...value, name: value.name || suggestion.name, text: suggestion.text })
                setEditorKey((key) => key + 1)
                setSuggestion(null)
                setNotice('Suggestion added. Save your profile when you’re ready.')
              }}
            >
              Use this profile
            </Button>
            <Button onClick={() => setSuggestion(null)}>Dismiss</Button>
          </div>
        </Block>
      )}
      <div className="sky-set-savebar">
        <Button
          variant="primary"
          loading={busy === 'save'}
          disabled={!!busy || !changed(value) || !!invalidLink || tooLong || conflict || !loaded}
          onClick={() => void save()}
        >
          Save about me
        </Button>
        <span role="status">{notice || (changed(value) ? 'Unsaved changes' : 'Your profile is up to date.')}</span>
      </div>
      {memoryNotes > 0 && (
        <div className="sky-set-memory">
          <div>
            <strong>What Sky remembers</strong>
            <p>
              {memoryNotes} {memoryNotes === 1 ? 'note' : 'notes'} learned across your conversations.
            </p>
          </div>
          <Button component="a" href="/explorer/ai/memory">
            View memories
          </Button>
        </div>
      )}
    </>
  )
}
