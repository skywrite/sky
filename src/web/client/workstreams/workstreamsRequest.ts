export async function workstreamRequest<T>(
  path: string,
  method = 'GET',
  data?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/workstreams/_api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    ...(signal ? { signal } : {}),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.message ?? `Sky could not complete this step (${response.status}).`)
  return body as T
}
