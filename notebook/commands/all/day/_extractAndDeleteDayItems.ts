import colors from 'picocolors'
import * as path from 'node:path'
import { readTextFile, writeTextFile } from '#shared/fs/mod.ts'
import ListDocument from '#shared/models/Markdown/ListDocument/mod.ts'
import type { Link } from '#shared/models/Markdown/Link/mod.ts'

export interface ExtractedItems {
  items: string[]
  links: Map<string, Link>
}

export default async function extractAndDeleteDayItems(
  markdownBackLogFile: string,
  dateScanString: string,
): Promise<ExtractedItems> {
  const markdownContents = await readTextFile(markdownBackLogFile)
  const doc = ListDocument.fromMarkdown(markdownContents)

  // Check for past dates and warn
  doc.lists.forEach((list) => {
    if (list.title < dateScanString) {
      const msg =
        colors.magentaBright('  WARN: ') +
        `${colors.yellowBright(path.basename(markdownBackLogFile))}: ${list.title} has already happened.`
      console.log(msg)
    }
  })

  // Find all occurrences of the date
  const matchingIndexes: number[] = []
  doc.lists.forEach((list, index) => {
    if (list.title === dateScanString) {
      matchingIndexes.push(index)
    }
  })

  // No date found
  if (matchingIndexes.length === 0) return { items: [], links: new Map() }

  // Get the last matching list (in case there are duplicates)
  const lastIndex = matchingIndexes[matchingIndexes.length - 1]
  const targetList = doc.lists[lastIndex]

  // Extract the items
  const items = [...targetList.items]

  // Extract reference links used by these items before removing the list
  const links = new Map<string, Link>()
  for (const item of items) {
    for (const [key, link] of doc.referenceLinks(item)) {
      links.set(key, link)
    }
  }

  // Remove the list from the document (ListDocument is immutable)
  let newDoc = doc.removeList(lastIndex)

  // Remove extracted links from the schedule file
  if (links.size > 0) {
    const remainingLinks = new Map(newDoc.links)
    for (const key of links.keys()) {
      remainingLinks.delete(key)
    }
    newDoc = newDoc.updateLinks(remainingLinks)
  }

  // Write the updated document back
  await writeTextFile(markdownBackLogFile, newDoc.toMarkdown())

  return { items, links }
}
