export class MeetingRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export async function meetingRequest<T>(url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(
    `/meetings/_api/${url}`,
    body === undefined
      ? { signal }
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal,
        },
  )
  const data = (await response.json().catch(() => ({}))) as T & { message?: string }
  if (!response.ok)
    throw new MeetingRequestError(data.message ?? 'Could not reach the meeting service. Try again.', response.status)
  return data
}
