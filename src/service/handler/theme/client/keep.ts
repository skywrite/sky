/**
 * A kept file as the service describes it, and the two ways a page talks to the keeping routes:
 * a JSON question, and bytes on their way up with progress that is real. The day's files and a
 * document's attachments share these.
 */

export type FileKind = 'image' | 'audio' | 'video' | 'pdf' | 'text' | 'document' | 'archive' | 'file'

/** A file in a directory, as the service lists it. */
export interface ListedFile {
  name: string
  size: number
  /** ISO */
  modified: string
  kind: FileKind
}

export interface Located {
  path: string
  /** "Desktop", "Downloads" — the folder, as a person says it */
  where: string
}

/** What the look for the original found. */
export interface Locate {
  token: string
  match: Located | null
  ambiguous: Located[]
  already: boolean
}

/** "3.9 MB", "12 KB" */
export function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/** A JSON question to the service; the answer parsed, a refusal thrown with its message. */
export async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await r.json().catch(() => ({}))) as T & { message?: string }
  if (!r.ok) throw new Error(data.message ?? `${r.status}`)
  return data
}

/** The bytes PUT to a URL, with progress that is real: the one wait a copy has. The answer, parsed. */
export function uploadBytes<T>(url: string, file: File, onProgress: (fraction: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total)
    }
    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText) as T & { message?: string }
        if (xhr.status >= 200 && xhr.status < 300) resolve(body)
        else reject(new Error(body.message ?? `Upload failed (${xhr.status})`))
      } catch {
        reject(new Error('Upload failed'))
      }
    }
    xhr.onerror = () => reject(new Error('Upload failed'))
    xhr.send(file)
  })
}
