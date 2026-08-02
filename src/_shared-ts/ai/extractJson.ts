/**
 * Extract a JSON value from model output.
 *
 * Models wrap JSON in fences, prefix it with prose, and — most damagingly —
 * append commentary *after* the closing fence when they think something about
 * the input is wrong. Anchored stripping (`/^```/` plus `/```$/`) only survives
 * the clean case: a trailing note leaves the closing fence in the string and
 * `JSON.parse` dies on a backtick, discarding an otherwise perfect payload.
 *
 * Strategy, first success wins:
 *   1. the whole trimmed text — the common case, no fence at all
 *   2. each fenced block in order — handles prose on either side
 *   3. the first balanced `{...}` / `[...]` span — handles unfenced prose
 *
 * Throws when nothing parses, so callers keep their existing try/catch.
 */
export function extractJson<T = unknown>(text: string): T {
  const trimmed = text.trim()

  const whole = tryParse<T>(trimmed)
  if (whole.ok) return whole.value

  for (const block of fencedBlocks(trimmed)) {
    const parsed = tryParse<T>(block.trim())
    if (parsed.ok) return parsed.value
  }

  const span = balancedSpan(trimmed)
  if (span) {
    const parsed = tryParse<T>(span)
    if (parsed.ok) return parsed.value
  }

  throw new Error(`No JSON found in model output: ${preview(trimmed)}`)
}

function tryParse<T>(candidate: string): { ok: true; value: T } | { ok: false } {
  if (!candidate) return { ok: false }
  try {
    return { ok: true, value: JSON.parse(candidate) as T }
  } catch {
    return { ok: false }
  }
}

/** Every ```-fenced block body, in source order, whatever the language tag. */
function fencedBlocks(text: string): string[] {
  const blocks: string[] = []
  const pattern = /```[a-zA-Z0-9_-]*[ \t]*\r?\n?([\s\S]*?)```/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) blocks.push(match[1])
  return blocks
}

/**
 * The first brace- or bracket-balanced span, skipping delimiters that appear
 * inside strings so `{"note": "}"}` doesn't terminate early.
 */
function balancedSpan(text: string): string | null {
  const start = text.search(/[{[]/)
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < text.length; i++) {
    const ch = text[i]

    if (escaped) {
      escaped = false
      continue
    }
    if (ch === '\\') {
      if (inString) escaped = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue

    if (ch === '{' || ch === '[') depth++
    else if (ch === '}' || ch === ']') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }

  return null
}

function preview(text: string): string {
  return text.length > 300 ? `${text.slice(0, 300)}…` : text
}
