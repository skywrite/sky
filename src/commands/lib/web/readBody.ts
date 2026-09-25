/** Page reads have no byte ceiling. Only fixed-shape API responses supply maxBytes. */
export async function readWebBody(
  response: Response,
  maxBytes: number | undefined,
  signal: AbortSignal,
  onBytes?: (bytes: number) => void,
) {
  const reader = response.body?.getReader()
  if (!reader) return { text: '', truncated: false }
  const chunks: Uint8Array[] = []
  let length = 0
  let truncated = false
  try {
    while (true) {
      signal.throwIfAborted()
      const part = await reader.read()
      signal.throwIfAborted()
      if (part.done) break
      const remaining = maxBytes === undefined ? part.value.byteLength : Math.max(0, maxBytes - length)
      const size = Math.min(remaining, part.value.byteLength)
      if (size) chunks.push(part.value.subarray(0, size))
      length += size
      onBytes?.(size)
      if (size < part.value.byteLength) {
        truncated = true
        break
      }
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  return { text: new TextDecoder().decode(Buffer.concat(chunks, length), { stream: truncated }), truncated }
}
