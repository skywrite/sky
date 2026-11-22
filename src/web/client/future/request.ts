export async function futureRequest<T>(url: string, data?: unknown): Promise<T> {
  const response = await fetch(`/future/_api${url}`, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.message ?? `Sky could not finish this step (${response.status}).`)
  return body as T
}
