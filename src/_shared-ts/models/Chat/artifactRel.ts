/**
 * rel entries for the external artifacts a chat session's tools touched.
 *
 * Each becomes a `"[Title](url)"` string in the saved transcript's rel:
 * the URL is the durable pointer, the title is what relContains queries
 * and future readers match on. Deterministic and additive — these ride
 * alongside hand-written or auto-chosen rel, never instead of them.
 */

/**
 * An external file a tool reported touching. Structural on purpose — the
 * hosts' tool layers own their own richer refs and pass them straight in.
 */
export interface ExternalFileRef {
  title: string
  url: string
}

/**
 * Collects title-by-URL across a session. Re-touching a file keeps one
 * entry and adopts the newest title (missions rename files they work on).
 */
export function recordExternalFiles(collected: Map<string, string>, files: ExternalFileRef[]): void {
  for (const f of files) collected.set(f.url, f.title)
}

/**
 * Render collected artifacts as rel entries, skipping any URL an existing
 * rel entry already carries — a hand-written bare URL and this session's
 * titled link for the same file must not both appear.
 */
export function artifactRelEntries(collected: ReadonlyMap<string, string>, existing?: string[]): string[] {
  const entries: string[] = []
  for (const [url, title] of collected) {
    if (existing?.some((e) => e.includes(url))) continue
    entries.push(`[${title}](${url})`)
  }
  return entries
}
