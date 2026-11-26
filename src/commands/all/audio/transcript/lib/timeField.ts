/**
 * The time field, settled from what a run knows: the extraction's reading,
 * or the fields a kept record carries; what the caller stated; what the
 * file's clock says.
 *
 * A stated start — typed on the command line, or changed by hand in the
 * import dialog — is the person's word. It replaces a fresh extraction, and
 * fills a kept record that has no time; a time a kept record does have was
 * settled at an earlier check, and stays. The clock is sky's own reading of
 * the file, never a statement: it fills a time nothing else gave, and
 * replaces nothing. A correction typed at the check is applied after this,
 * and wins. A day chosen by dropping on the Meetings section fixes only the
 * date; it leaves the extracted meeting time intact.
 */

export interface TimeFieldInputs {
  /** The time as extracted, or as a kept record carries it; null when neither has one */
  time: string | null
  /** The fields came from a kept record rather than a fresh extraction */
  kept: boolean
  /** What the caller stated, YYYY-MM-DD HH:MM; null when nobody did */
  stated: string | null
  /** Only the meeting date was chosen, YYYY-MM-DD; the extracted clock time still wins */
  day?: string | null
  /** What the file's clock says the start is, YYYY-MM-DD HH:MM; null when no host read one */
  clock: string | null
}

export function resolveTimeField({ time, kept, stated, day, clock }: TimeFieldInputs): string | null {
  if (kept && time) return time
  if (stated) return stated
  const resolved = time || clock
  return day && resolved ? resolved.replace(/^\d{4}-\d{2}-\d{2}/, day) : resolved
}

export interface DurationFieldInputs {
  /** Duration extracted from the summary, or carried by a kept run record; null when neither has one */
  extracted: number | null
  /** Exact duration computed from transcript timestamps; null for voice memos or unstamped text */
  pipeline: number | null
  /** Fallback duration in minutes (e.g. from a matched calendar event); null when none */
  fallback: number | null
  /** Whether `extracted` came from a kept run record rather than a fresh extraction */
  kept: boolean
}

/**
 * Settle meeting duration in minutes: a kept check value stays, then exact transcript timestamps,
 * then duration extracted from the words, and finally a calendar fallback when none of those gave one.
 */
export function resolveDurationField({ extracted, pipeline, fallback, kept }: DurationFieldInputs): number | null {
  if (kept && extracted !== null) return extracted
  if (pipeline !== null) return pipeline
  if (extracted !== null) return extracted
  return fallback !== null && Number.isFinite(fallback) && fallback >= 1 ? Math.round(fallback) : null
}
