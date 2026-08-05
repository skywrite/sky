import { DIR_TIME } from '#config'
import type { Link } from '#shared/models/Markdown/Link/mod.ts'
import { normalizeToPlainDate, readDay, writeDay } from '#shared/nbfs/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

interface WriteDayItemsOptions {
  links?: Map<string, Link>
  timeDir?: string
}

/**
 * Add items to a day's collection and write the updated day file.
 *
 * @param day - PlainDate instance or YMD string (e.g., "2025-03-15")
 * @param collectionTitle - Title of the collection to add items to
 * @param items - Single item or array of items to add
 * @param opts - Options: links (reference link definitions), timeDir (directory containing day files)
 */
export default async function writeDayItems(
  day: PlainDate | string,
  collectionTitle: string,
  items: string | string[],
  opts: WriteDayItemsOptions = {},
): Promise<void> {
  const { links, timeDir = DIR_TIME } = opts
  const plainDate = normalizeToPlainDate(day)
  if (typeof items === 'string') items = [items]

  let dayObj = await readDay(plainDate, timeDir)
  for (let i = 0; i < items.length; i++) {
    dayObj = dayObj.addItem(collectionTitle, items[i], i === 0 ? { links } : undefined)
  }

  await writeDay(dayObj)
}
