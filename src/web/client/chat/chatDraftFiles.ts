interface StoredFiles {
  revision: string
  files: File[]
}

let opening: Promise<IDBDatabase> | undefined

function database(): Promise<IDBDatabase> {
  if (!opening) {
    opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('sky-chat-drafts', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('files')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        db.onversionchange = () => {
          db.close()
          opening = undefined
        }
        resolve(db)
      }
    }).catch((error) => {
      opening = undefined
      throw error
    })
  }
  return opening
}

export async function readDraftFiles(id: string, revision: string): Promise<File[]> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('files', 'readonly')
    const request = transaction.objectStore('files').get(id)
    transaction.onabort = () => reject(transaction.error)
    transaction.onerror = () => reject(transaction.error)
    transaction.oncomplete = () => {
      const stored = request.result as StoredFiles | undefined
      if (
        stored?.revision !== revision ||
        !Array.isArray(stored.files) ||
        !stored.files.every((f) => f instanceof File)
      ) {
        reject(new Error('The attachment draft is incomplete.'))
      } else resolve(stored.files)
    }
  })
}

export async function writeDraftFiles(id: string, revision: string | null, files: File[]): Promise<void> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('files', 'readwrite')
    const store = transaction.objectStore('files')
    if (revision) store.put({ revision, files } satisfies StoredFiles, id)
    else store.delete(id)
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error)
    transaction.onerror = () => reject(transaction.error)
  })
}
