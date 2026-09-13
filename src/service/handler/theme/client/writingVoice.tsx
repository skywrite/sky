import { Button, Select, Textarea, TextInput } from '@mantine/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { VoiceDraft, VoiceExampleRecord, VoiceRules } from '#lib/writingVoice/types.ts'
import { Block } from './settingsBlocks.tsx'
import './writingVoice.css'

const API = '/settings/_api/writing-voice'

export async function writingVoiceRequest<T>(route: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`${API}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const data = (await response.json().catch(() => ({}))) as { message?: string }
  if (!response.ok) throw new Error(data.message ?? `Sky answered ${response.status}.`)
  return data as T
}

function ExampleCard({
  example,
  onChange,
}: {
  key?: string
  example: VoiceExampleRecord
  onChange: (example: VoiceExampleRecord) => void
}) {
  const [own, setOwn] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const act = async (action: string, answer?: { option?: number; text?: string }) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const result = await writingVoiceRequest<{ example: VoiceExampleRecord }>(
        `/examples/${example.id}/${action}`,
        'POST',
        {
          revision: example.revision,
          ...answer,
        },
      )
      onChange(result.example)
      setOwn(false)
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Sky could not save your answer.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="sky-writing-example" aria-label="Learn from your revision">
      <div className="sky-writing-label">Your writing voice · {example.medium}</div>
      {example.lesson ? (
        <>
          <p className="sky-writing-lesson" role="status">
            Learned: {example.lesson.text}
          </p>
          <p className="sky-writing-scope">Applies to: {example.lesson.scope}</p>
        </>
      ) : example.answer ? (
        <p role="status">
          {example.error
            ? 'Your answer is saved. Sky could not finish the lesson.'
            : 'Your answer is saved. Sky is learning from it…'}
        </p>
      ) : example.question ? (
        <>
          <p className="sky-writing-question">{example.question.question}</p>
          <div className="sky-writing-change">
            <div>
              <span>From</span>
              <p>{example.question.before || '(added text)'}</p>
            </div>
            <div>
              <span>To</span>
              <p>{example.question.after || '(removed text)'}</p>
            </div>
          </div>
          <div className="sky-writing-choices">
            {example.question.options.map((option, index) => (
              <Button key={index} disabled={busy} onClick={() => void act('answer', { option: index })}>
                {option}
              </Button>
            ))}
            <Button variant="primary-quiet" disabled={busy} onClick={() => setOwn(!own)}>
              Write my own
            </Button>
          </div>
          {own && (
            <div className="sky-writing-own">
              <Textarea
                autoFocus
                label="What would you like Sky to learn?"
                value={text}
                onChange={(event) => setText(event.currentTarget.value)}
                autosize
                minRows={2}
                maxLength={4000}
                disabled={busy}
              />
              <Button variant="primary" disabled={busy || !text.trim()} onClick={() => void act('answer', { text })}>
                Save answer
              </Button>
            </div>
          )}
        </>
      ) : (
        <p role="status">
          {example.error
            ? 'Your example is saved. Sky could not prepare the question.'
            : 'Sky is preparing one question about your revision…'}
        </p>
      )}
      {(error || example.error) && (
        <p role="alert" className="sky-writing-error">
          {error || example.error}
        </p>
      )}
      {example.error && (
        <Button disabled={busy} onClick={() => void act('prepare')}>
          Retry learning
        </Button>
      )}
      {busy && <p role="status">Saving your answer and learning from it…</p>}
      <details className="sky-writing-pair">
        <summary>Draft, revision, and your answer</summary>
        <div className="sky-writing-change">
          <div>
            <span>Original draft</span>
            <p>{example.original}</p>
          </div>
          <div>
            <span>Your revision</span>
            <p>{example.revised}</p>
          </div>
        </div>
        {example.answer && <p>Your answer: {example.answer}</p>}
      </details>
    </section>
  )
}

/** One unresolved question at a time, shared by Chat and Outbox. */
export function WritingVoiceQuestions({
  source,
  refreshKey,
  polling = false,
}: {
  key?: string
  source: string
  refreshKey?: string | number
  polling?: boolean
}) {
  const [examples, setExamples] = useState<VoiceExampleRecord[]>([])
  const [error, setError] = useState('')
  const [learned, setLearned] = useState<VoiceExampleRecord | null>(null)
  const awaiting = examples.some(
    (example) => !example.lesson && !example.error && (!example.question || example.answer),
  )
  useEffect(() => {
    let active = true
    const load = () =>
      writingVoiceRequest<{ examples: VoiceExampleRecord[] }>(`/examples?source=${encodeURIComponent(source)}`)
        .then((data) => {
          if (active) {
            setExamples(data.examples)
            setError('')
          }
        })
        .catch((problem: unknown) => {
          if (active) setError(problem instanceof Error ? problem.message : 'Writing questions could not be loaded.')
        })
    void load()
    const timer = polling || awaiting ? setInterval(() => void load(), 3000) : undefined
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [source, refreshKey, polling, awaiting])
  useEffect(() => {
    setExamples([])
    setLearned(null)
    setError('')
  }, [source])
  const example = examples.find((entry) => !entry.lesson) ?? learned
  if (!example) return null
  return (
    <div className="sky-writing-questions">
      <ExampleCard
        key={example.id}
        example={example}
        onChange={(next) => {
          setExamples((current) => current.map((entry) => (entry.id === next.id ? next : entry)))
          if (next.lesson) setLearned(next)
        }}
      />
      {error && <p role="alert">{error}</p>}
    </div>
  )
}

type VoiceStatus = {
  rules: VoiceRules
  examples: VoiceExampleRecord[]
  compacting: boolean
  compactionError: string | null
}

export function WritingVoicePane({
  model,
  onModelChange,
}: {
  model: { profile: string; choices: Array<{ value: string; label: string }> }
  onModelChange: (profile: string) => void
}) {
  const [status, setStatus] = useState<VoiceStatus | null>(null)
  const [rules, setRules] = useState('')
  const [rulesRevision, setRulesRevision] = useState('')
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [meaning, setMeaning] = useState('')
  const [medium, setMedium] = useState('Email')
  const [original, setOriginal] = useState('')
  const [revised, setRevised] = useState('')
  const initialized = useRef(false)
  const reload = useCallback(async () => {
    const data = await writingVoiceRequest<VoiceStatus>('')
    setStatus(data)
    if (!initialized.current) {
      setRules(data.rules.text)
      setRulesRevision(data.rules.revision)
      initialized.current = true
    }
  }, [])
  useEffect(() => {
    void reload().catch((problem: unknown) =>
      setError(problem instanceof Error ? problem.message : 'Writing voice could not be loaded.'),
    )
  }, [reload])
  useEffect(() => {
    if (!status?.compacting) return
    const timer = setInterval(() => void reload().catch(() => {}), 2500)
    return () => clearInterval(timer)
  }, [status?.compacting, reload])
  const act = async (work: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setError('')
    setNote('')
    try {
      await work()
      await reload()
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Sky could not complete this step.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="sky-writing-settings">
      {error && (
        <p role="alert" className="sky-writing-error">
          {error}
        </p>
      )}
      {note && <p role="status">{note}</p>}

      <Block
        head="Writing rules"
        note="Prose, words, punctuation, characters, and formatting. Add context when a preference applies only to certain messages."
      >
        <Textarea
          label="Your writing rules"
          value={rules}
          onChange={(event) => setRules(event.currentTarget.value)}
          autosize
          minRows={8}
          maxRows={24}
          maxLength={80_000}
          disabled={!status || busy}
        />
        <div className="sky-writing-actions">
          <Button
            variant="primary"
            disabled={!status || busy || rules === status.rules.text}
            onClick={() =>
              void act(async () => {
                const saved = await writingVoiceRequest<VoiceRules>('/rules', 'PUT', {
                  text: rules,
                  revision: rulesRevision,
                })
                setRules(saved.text)
                setRulesRevision(saved.revision)
                setNote('Writing rules saved.')
              })
            }
          >
            Save rules
          </Button>
          {status && status.rules.revision !== rulesRevision && (
            <Button
              disabled={busy}
              onClick={() => {
                setRules(status.rules.text)
                setRulesRevision(status.rules.revision)
              }}
            >
              Load updated rules
            </Button>
          )}
        </div>
      </Block>
      <Block
        head="Try your voice"
        note="Give Sky the meaning, then revise its draft. Sky will ask one question to understand your edit."
      >
        <TextInput
          label="Medium"
          value={medium}
          onChange={(event) => setMedium(event.currentTarget.value)}
          maxLength={80}
        />
        <Textarea
          label="What do you want to say?"
          value={meaning}
          onChange={(event) => setMeaning(event.currentTarget.value)}
          autosize
          minRows={3}
          maxLength={40_000}
        />
        <div className="sky-writing-actions">
          <Button
            disabled={busy || !meaning.trim() || !medium.trim()}
            onClick={() =>
              void act(async () => {
                const result = await writingVoiceRequest<VoiceDraft>('/draft', 'POST', { meaning, medium })
                setOriginal(result.draft)
                setRevised(result.draft)
              })
            }
          >
            Draft in my voice
          </Button>
        </div>
        {original && (
          <>
            <Textarea
              label="Revise the draft"
              value={revised}
              onChange={(event) => setRevised(event.currentTarget.value)}
              autosize
              minRows={3}
              maxLength={40_000}
            />
            <div className="sky-writing-actions">
              <Button
                variant="primary"
                disabled={busy || !revised.trim() || original === revised}
                onClick={() =>
                  void act(async () => {
                    await writingVoiceRequest('/examples', 'POST', {
                      original,
                      revised,
                      medium,
                      context: meaning.slice(0, 8000),
                    })
                    setOriginal('')
                    setRevised('')
                    setNote('Example saved. Answer the question below to teach Sky why you changed it.')
                  })
                }
              >
                Learn from this revision
              </Button>
            </div>
          </>
        )}
      </Block>
      <Block
        head="Learning from your revisions"
        note="Each example keeps the draft, your revision, and your explanation. After eight confirmed lessons, Sky consolidates them into your rules and removes the processed examples."
      >
        {status?.compactionError && (
          <p role="alert">Compaction paused: {status.compactionError} Your examples are still available.</p>
        )}
        <div className="sky-writing-actions">
          <Button
            disabled={busy || status?.compacting || !status?.examples.some((example) => example.lesson)}
            onClick={() =>
              void act(async () => {
                const result = await writingVoiceRequest<{ compacted: number }>('/compact', 'POST', {})
                setNote(`${result.compacted} examples compacted into your writing rules.`)
              })
            }
          >
            {status?.compacting ? 'Compacting examples…' : 'Compact learned examples'}
          </Button>
        </div>
        {status && status.examples.length === 0 && (
          <p className="sky-set-note">Your revisions will appear here as Sky learns your voice.</p>
        )}
        {status?.examples.map((example) => (
          <ExampleCard
            key={example.id}
            example={example}
            onChange={(next) => {
              setStatus((current) =>
                current
                  ? { ...current, examples: current.examples.map((entry) => (entry.id === next.id ? next : entry)) }
                  : current,
              )
              void reload().catch(() => {})
            }}
          />
        ))}
      </Block>
      <details className="sky-set-disclosure">
        <summary>Writing model</summary>
        <Block
          head="Writing model"
          note="Used for drafting, learning from your edits, and compacting examples. Changes apply to the next call in Chat and Outbox."
        >
          <Select
            label="Model configuration"
            searchable
            allowDeselect={false}
            value={model.profile}
            data={
              model.choices.some((choice) => choice.value === model.profile)
                ? model.choices
                : [
                    { value: model.profile, label: `Unavailable configuration: ${model.profile}`, disabled: true },
                    ...model.choices,
                  ]
            }
            onChange={(value) => value && onModelChange(value)}
            disabled={busy}
            nothingFoundMessage="No matching model configurations"
          />
          <p className="sky-set-note">
            Manage model configurations and their settings in <a href="/settings/ai/models">AI &gt; Models</a>.
          </p>
        </Block>
      </details>
    </div>
  )
}
