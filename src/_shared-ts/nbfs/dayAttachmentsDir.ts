import * as path from 'node:path'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

/**
 * Returns the attachments directory path for a given day, relative to the attachments time directory.
 * Attachment files are organized by date: YYYY/MM/DD
 *
 * @param day - The PlainDate to get the attachments directory for
 * @returns The relative path to the day's attachments directory
 *
 * @example
 * dayAttachmentsDir(new PlainDate('2025-08-27'))
 * // Returns: "2025/08/27"
 */
export default function dayAttachmentsDir(day: PlainDate): string {
  return path.join(day.yearPadded, day.monthPadded, day.dayPadded)
}
