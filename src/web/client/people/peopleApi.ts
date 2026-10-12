export async function peopleApi<T>(path = '', body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/people/_api${path}`, {
    ...(body === undefined
      ? {}
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    signal,
  })
  const value = await response.json().catch(() => ({ message: 'Sky could not read the response. Try again.' }))
  if (!response.ok) throw new Error(value.message ?? 'The request could not be completed.')
  return value as T
}
