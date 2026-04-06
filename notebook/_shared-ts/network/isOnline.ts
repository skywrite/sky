const DEFAULT_TIMEOUT = 30_000

let _CACHE_EXPIRED = true
let _CACHE = false

export type isOnlineOptions = {
  timeout?: number
}

export default async function isOnline(opts: isOnlineOptions = { timeout: DEFAULT_TIMEOUT }): Promise<boolean> {
  if (!_CACHE_EXPIRED) return _CACHE

  const timeout = opts?.timeout ?? DEFAULT_TIMEOUT

  const controller = new AbortController()
  const signal = controller.signal

  setTimeout(() => {
    controller.abort()
  }, timeout)

  let online = false

  try {
    // use example.com since it supports CORS
    const response = await fetch('https://www.example.com', { signal })
    online = response.ok
  } catch (_error) {
    /*
    if (error.name === 'AbortError') {
      online = false
    } else {
      throw error
    }*/
    online = false
  }

  _CACHE = online
  _CACHE_EXPIRED = false
  setTimeout(() => {
    _CACHE_EXPIRED = true
  }, 60_0000)

  return online
}
