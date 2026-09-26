import { Button, Checkbox, Modal } from '@mantine/core'
import { useEffect, useState } from 'react'
import type { ProfileDetail, ReferenceFile, ReferencePreview, ReferenceResult } from '../../people/types.ts'
import { peopleApi } from './peopleApi.ts'

const KIND_LABELS: Record<string, string> = {
  meetings: 'Meetings',
  messages: 'Messages',
  'ai-chats': 'Chats',
  notes: 'Notes',
  events: 'Events',
  videos: 'Videos',
  days: 'Days',
  summaries: 'Summaries',
  people: 'People',
  orgs: 'Organizations',
  projects: 'Projects',
  library: 'Library',
}
const kindLabel = (kind: string) => KIND_LABELS[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1)
const files = (count: number) => `${count} ${count === 1 ? 'file' : 'files'}`
const fileName = (id: string) => id.split('/').at(-1) ?? id

/** One file's changes on a line: names as they change, the old file path by name and count. */
function changeLine(change: ReferenceFile['changes'][number]): string {
  if (change.field !== 'path') return `${change.field}: ${change.before} → ${change.after}`
  const times = change.count && change.count > 1 ? ` ×${change.count}` : ''
  return `file path: ${fileName(change.before)} → ${fileName(change.after)}${times}`
}

/** The line under a profile's name while other files still use another spelling. */
export function SpellingsNotice({ profile, open }: { profile: ProfileDetail; open: () => void }) {
  if (!profile.spellings.length) return null
  const total = profile.spellings.reduce((sum, spelling) => sum + spelling.files, 0)
  return (
    <p className="sky-people-spellings">
      {profile.spellings.length === 1 ? (
        <span>
          Also written <strong>{profile.spellings[0]!.name}</strong> in {files(total)}.
        </span>
      ) : (
        <span>
          Also written {profile.spellings.length} other ways in {files(total)}.
        </span>
      )}
      <Button size="compact-sm" onClick={open}>
        Update to {profile.name}
      </Button>
    </p>
  )
}

/** In the profile's details: when its file name no longer matches its name, the way to rename it. */
export function RenameFileLink({ profile, open }: { profile: ProfileDetail; open: () => void }) {
  if (!profile.renameFile) return null
  return (
    <Button size="compact-sm" className="sky-people-rename-file" onClick={open}>
      Rename file to {fileName(profile.renameFile)}
    </Button>
  )
}

/**
 * Update references: files that name this profile by another spelling, in their links,
 * attendees, senders or organizations, will name it by its current name. Text stays as written.
 */
export function ReferencesDialog({
  profile,
  opened,
  initial,
  onClose,
  onUpdated,
}: {
  profile: ProfileDetail
  opened: boolean
  /** The spelling to start with, such as the name just replaced */
  initial?: string
  onClose: () => void
  onUpdated: () => void
}) {
  const [chosen, setChosen] = useState<string[]>([])
  const [preview, setPreview] = useState<ReferencePreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<ReferenceResult | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!opened) return
    const names = profile.spellings.map((spelling) => spelling.name)
    setChosen(names.length === 1 ? names : names.filter((name) => name === initial))
    setResult(null)
    setError('')
    // Each opening starts over. The profile reloads while open, and a renamed file changes its
    // id, so later loads keep the choice and the result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened])
  useEffect(() => {
    if (!opened || (!chosen.length && !profile.renameFile) || result) {
      setPreview(null)
      return
    }
    const abort = new AbortController()
    setLoading(true)
    setError('')
    peopleApi<ReferencePreview>(
      '/references/preview',
      { type: profile.type, id: profile.id, spellings: chosen },
      abort.signal,
    )
      .then(setPreview)
      .catch((error: Error) => {
        if (!abort.signal.aborted) setError(error.message)
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false)
      })
    return () => abort.abort()
  }, [opened, chosen, profile.type, profile.id, profile.renameFile, result])
  const update = async () => {
    if (!preview) return
    setSaving(true)
    setError('')
    try {
      setResult(
        await peopleApi<ReferenceResult>('/references', {
          type: profile.type,
          id: profile.id,
          spellings: chosen,
          files: preview.files.map(({ id, revision }) => ({ id, revision })),
          ...(preview.file ? { file: preview.file.to } : {}),
        }),
      )
      onUpdated()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not update the files.')
    } finally {
      setSaving(false)
    }
  }
  const groups = new Map<string, ReferenceFile[]>()
  for (const file of preview?.files ?? []) groups.set(file.kind, [...(groups.get(file.kind) ?? []), file])
  const spellings = chosen.length ? chosen.join(', ') : 'another spelling'
  return (
    <Modal
      opened={opened}
      onClose={() => {
        if (!saving) onClose()
      }}
      title={`Update references · ${profile.name}`}
      size="lg"
      closeOnClickOutside={false}
    >
      {result ? (
        <div className="sky-people-reference-result">
          <p role="status">
            {[
              result.file && `Renamed the file to ${fileName(result.file)}.`,
              result.updated ? `Updated ${files(result.updated)}.` : !result.file && 'No files needed updating.',
            ]
              .filter(Boolean)
              .join(' ')}
          </p>
          {result.skipped.length > 0 && (
            <>
              <p>{files(result.skipped.length)} left as they are:</p>
              <ul>
                {result.skipped.map((file) => (
                  <li key={file.id}>
                    {file.label} <span className="sky-people-muted">{file.reason}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="sky-people-form-actions">
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="sky-people-reference-intro">
            {chosen.length > 0 &&
              `Files that name ${spellings} in their links, attendees, senders or organizations will name ${profile.name}. `}
            {profile.renameFile && 'The file is renamed to match, and every file that writes out its path follows. '}
            What the files say stays as written.
          </p>
          {profile.spellings.length > 1 && (
            <div className="sky-people-spelling-choices">
              {profile.spellings.map((spelling) => (
                <Checkbox
                  key={spelling.name}
                  label={`${spelling.name} · ${files(spelling.files)}`}
                  checked={chosen.includes(spelling.name)}
                  onChange={(event) => {
                    const checked = event.currentTarget.checked
                    setChosen((names) =>
                      checked ? [...names, spelling.name] : names.filter((name) => name !== spelling.name),
                    )
                  }}
                />
              ))}
            </div>
          )}
          {loading && (
            <p role="status" className="sky-people-muted">
              Finding every reference…
            </p>
          )}
          {preview && !loading && (
            <div className="sky-people-reference-preview">
              {preview.file && (
                <p className="sky-people-reference-file">
                  File <span>{fileName(preview.file.from)}</span> → <span>{fileName(preview.file.to)}</span>
                </p>
              )}
              {[...groups].map(([kind, list]) => (
                <details key={kind}>
                  <summary>
                    {kindLabel(kind)} <span className="sky-people-count">{list.length}</span>
                  </summary>
                  <ul>
                    {list.map((file) => (
                      <li key={file.id}>
                        <span>{file.label}</span>
                        <span className="sky-people-muted">{file.changes.map(changeLine).join(' · ')}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
              {preview.skipped.length > 0 && (
                <details>
                  <summary>
                    Left as they are <span className="sky-people-count">{preview.skipped.length}</span>
                  </summary>
                  <ul>
                    {preview.skipped.map((file) => (
                      <li key={file.id}>
                        <span>{file.label}</span>
                        <span className="sky-people-muted">{file.reason}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {!preview.files.length && !preview.skipped.length && !preview.file && (
                <p className="sky-people-muted">No other file uses {spellings} for this profile.</p>
              )}
            </div>
          )}
          {error && (
            <p role="alert" className="sky-people-error">
              {error}
            </p>
          )}
          <div className="sky-people-form-actions">
            <Button onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                void update()
              }}
              loading={saving}
              disabled={loading || !(preview?.files.length || preview?.file)}
            >
              {preview?.files.length
                ? `Update ${files(preview.files.length)}`
                : preview?.file
                  ? 'Rename the file'
                  : 'Update'}
            </Button>
          </div>
        </>
      )}
    </Modal>
  )
}
