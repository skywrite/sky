export class BrowserSetupError extends Error {}

type SetupOperation = '' | 'connect' | 'refresh' | 'disconnect' | 'vaults' | 'open-settings'

export async function browserSetupRequest<T>(operation: SetupOperation = '', body?: unknown): Promise<T> {
  const response = await fetch(`/settings/_api/browser-automation${operation ? `/${operation}` : ''}`, {
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    cache: 'no-store',
  })
  const result = await response.json().catch(() => null)
  if (!response.ok) throw new BrowserSetupError(result?.message ?? 'Browser settings could not be loaded. Try again.')
  return result as T
}

export function browserSetupFailure(error: unknown): string {
  return error instanceof BrowserSetupError ? error.message : 'Could not reach Sky. Try again.'
}
