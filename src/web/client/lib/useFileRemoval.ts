import { useEffect, useRef, useState } from 'react'
import {
  announceChanged,
  removedLine,
  type RemoveToast,
  removeFile,
  TOAST_MS,
  undoRemove,
} from '../explorer/explorerDelete.tsx'

interface RemovalOptions {
  after: string
  restore: string
  before?: () => Promise<void>
}

type Notice = RemoveToast & { restore: string }

/** Keep Delete and Undo alive when a document's page turns to its day or folder. */
export function useFileRemoval(go: (to: string) => void) {
  const [toast, setToast] = useState<Notice | null>(null)
  const [removing, setRemoving] = useState(false)
  const busy = useRef(false)
  const sequence = useRef(0)
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), TOAST_MS)
    return () => window.clearTimeout(timer)
  }, [toast])

  const remove = async (file: string, options: RemovalOptions) => {
    if (busy.current || !file) return
    busy.current = true
    setRemoving(true)
    try {
      await options.before?.()
      const removed = await removeFile(file)
      announceChanged(file.split('/').slice(0, -1).join('/'))
      setToast({
        key: ++sequence.current,
        text: removedLine(file, removed.day),
        file,
        moveId: removed.moveId,
        restore: options.restore,
      })
      go(options.after)
    } catch (err) {
      const name = file.split('/').pop() ?? file
      const reason = err instanceof Error ? err.message : 'Try again.'
      setToast({
        key: ++sequence.current,
        text: `Could not delete “${name}”. ${reason}`,
        file,
        moveId: null,
        restore: options.restore,
      })
    } finally {
      busy.current = false
      setRemoving(false)
    }
  }

  const undo = async () => {
    const held = toast
    if (busy.current || !held?.moveId) return
    busy.current = true
    setToast(null)
    try {
      await undoRemove(held.moveId)
      announceChanged(held.file.split('/').slice(0, -1).join('/'))
      go(held.restore)
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Try again.'
      setToast({
        ...held,
        key: ++sequence.current,
        text: `Could not restore “${held.file.split('/').pop()}”. ${reason}`,
        moveId: null,
      })
    } finally {
      busy.current = false
    }
  }

  return { toast, removing, remove, undo }
}

export type FileRemoval = ReturnType<typeof useFileRemoval>
