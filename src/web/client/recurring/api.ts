import type { RecurringFile, RecurringSource } from '../../../service/handler/recurring/types.ts'

export async function recurringApi<T>(route = '', data?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch('/recurring/_api' + route, {
    method: data === undefined ? 'GET' : 'POST',
    signal,
    ...(data === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.message ?? 'Recurring items could not be loaded. Try again.')
  return body as T
}

export function recurringRevisions(files: RecurringFile[]): Record<RecurringSource, string> {
  return Object.fromEntries(files.map((file) => [file.source, file.revision])) as Record<RecurringSource, string>
}
