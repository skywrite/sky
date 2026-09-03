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
 * and wins.
 */

export interface TimeFieldInputs {
  /** The time as extracted, or as a kept record carries it; null when neither has one */
  time: string | null
  /** The fields came from a kept record rather than a fresh extraction */
  kept: boolean
  /** What the caller stated, YYYY-MM-DD HH:MM; null when nobody did */
  stated: string | null
  /** What the file's clock says the start is, YYYY-MM-DD HH:MM; null when no host read one */
  clock: string | null
}

export function resolveTimeField({ time, kept, stated, clock }: TimeFieldInputs): string | null {
  if (stated && (!kept || !time)) return stated
  if (!time && clock) return clock
  return time
}
