import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { readDraftFiles, writeDraftFiles } from './chatDraftFiles.ts'

interface DraftMetadata {
  text: string
  /** A synchronous revision prevents removed or accepted files from returning after a reload. */
  filesRevision: string | null
}

interface DraftState extends DraftMetadata {
  files: File[]
  loading: boolean
  saving: boolean
  textError: string | null
  filesError: string | null
}

const drafts = new Map<string, Draft>()
const storageKey = (id: string) => `sky-chat-draft:${id}`
const TEXT_ERROR = 'This draft could not be saved in this browser. Keep this tab open and retry.'
const FILES_ERROR = 'The attachments could not be saved. Keep this tab open and retry.'

class Draft {
  private state: DraftState
  private listeners = new Set<() => void>()
  private writes = Promise.resolve()

  constructor(private id: string) {
    let metadata: DraftMetadata = { text: '', filesRevision: null }
    let textError: string | null = null
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(storageKey(id)) ?? 'null')
      if (stored !== null) {
        if (
          typeof stored !== 'object' ||
          !('text' in stored) ||
          typeof stored.text !== 'string' ||
          !('filesRevision' in stored) ||
          (stored.filesRevision !== null && typeof stored.filesRevision !== 'string')
        )
          throw new Error('Invalid draft metadata')
        metadata = { text: stored.text, filesRevision: stored.filesRevision }
      }
    } catch {
      textError = TEXT_ERROR
    }
    this.state = {
      ...metadata,
      files: [],
      loading: Boolean(metadata.filesRevision),
      saving: false,
      textError,
      filesError: null,
    }
    if (metadata.filesRevision) this.restoreFiles(metadata.filesRevision)
  }

  snapshot = () => this.state
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private update(patch: Partial<DraftState>) {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }

  private restoreFiles(revision: string) {
    this.update({ loading: true, filesError: null })
    void readDraftFiles(this.id, revision).then(
      (files) => this.update({ files, loading: false }),
      () =>
        this.update({
          loading: false,
          filesError: 'Saved attachments could not be restored. Retry, or reattach the files before sending.',
        }),
    )
  }

  private saveMetadata() {
    try {
      const { text, filesRevision } = this.state
      if (text || filesRevision) localStorage.setItem(storageKey(this.id), JSON.stringify({ text, filesRevision }))
      else localStorage.removeItem(storageKey(this.id))
      this.update({ textError: null })
    } catch {
      this.update({ textError: TEXT_ERROR })
    }
  }

  private saveFiles() {
    const { files, filesRevision } = this.state
    this.update({ saving: true, filesError: null })
    // Add, remove and acceptance must reach storage in that order, including after navigation.
    this.writes = this.writes.catch(() => {}).then(() => writeDraftFiles(this.id, filesRevision, files))
    void this.writes.then(
      () => {
        if (this.state.filesRevision === filesRevision) this.update({ saving: false })
      },
      () => {
        if (this.state.filesRevision === filesRevision)
          this.update({ saving: false, filesError: files.length ? FILES_ERROR : null })
      },
    )
  }

  setText = (text: string) => {
    this.update({ text })
    // Text is small: save in the input event, with no debounce that a refresh could interrupt.
    this.saveMetadata()
  }

  setFiles = (change: (files: File[]) => File[]) => {
    if (this.state.loading) return
    const files = change(this.state.files)
    if (files.length === this.state.files.length && files.every((file, index) => file === this.state.files[index]))
      return
    this.update({ files, filesRevision: files.length ? crypto.randomUUID() : null })
    this.saveMetadata()
    this.saveFiles()
  }

  accepted = (text: string, files: File[]) => {
    if (this.state.text === text) this.setText('')
    this.setFiles((pending) => pending.filter((file) => !files.includes(file)))
  }

  retry = () => {
    this.saveMetadata()
    // A failed read is not an empty attachment draft: never overwrite it on retry.
    if (this.state.filesRevision && this.state.files.length === 0) this.restoreFiles(this.state.filesRevision)
    else if (this.state.filesRevision) this.saveFiles()
  }
}

function draftFor(id: string): Draft {
  let draft = drafts.get(id)
  if (!draft) {
    draft = new Draft(id)
    drafts.set(id, draft)
  }
  return draft
}

/** A page can offer a conversation in the composer; sending remains the person's action. */
export function stageChatDraft(id: string, text: string): string | null {
  const draft = draftFor(id)
  draft.setText(text)
  return draft.snapshot().textError
}

export function useChatDraft(id: string) {
  const draft = useMemo(() => draftFor(id), [id])
  const state = useSyncExternalStore(draft.subscribe, draft.snapshot)
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      const current = draft.snapshot()
      if (
        (current.saving && current.files.length > 0) ||
        ((current.text || current.filesRevision) && (current.textError || current.filesError))
      ) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [draft])
  return {
    text: state.text,
    files: state.files,
    loading: state.loading,
    saving: state.saving,
    error: state.textError ?? state.filesError,
    missingFiles: Boolean(state.filesRevision && !state.loading && state.files.length === 0),
    setText: draft.setText,
    setFiles: draft.setFiles,
    accepted: draft.accepted,
    retry: draft.retry,
  }
}

export type ChatDraft = ReturnType<typeof useChatDraft>
