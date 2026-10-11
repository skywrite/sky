import type { GoogleClient } from '#lib/google/client.ts'
import { batchUpdateDoc, fetchDoc, flattenTabs, summarizeDocument } from '#lib/google/docs.ts'
import { batchesOf, planRestyle } from '#lib/google/docsRestyle.ts'
import type { RawRestyleDocument, RestyleSpec } from '#lib/google/docsRestyle.ts'

/** A starting style for newly authored documents, never an automatic restyle of an existing file. */
const STANDARD_TYPOGRAPHY: RestyleSpec = {
  fontFamily: 'Arial',
  sizes: {
    title: 22,
    subtitle: 13,
    heading1: 20,
    heading2: 14,
    heading3: 12,
    heading4: 11,
    heading5: 11,
    heading6: 11,
    body: 11,
  },
}

export function planCreationStyle(doc: RawRestyleDocument): Array<Record<string, unknown>> {
  const requests: Array<Record<string, unknown>> = [
    {
      updateDocumentStyle: {
        documentStyle: {
          marginTop: { magnitude: 36, unit: 'PT' },
          marginBottom: { magnitude: 36, unit: 'PT' },
          marginLeft: { magnitude: 48, unit: 'PT' },
          marginRight: { magnitude: 48, unit: 'PT' },
        },
        fields: 'marginTop,marginBottom,marginLeft,marginRight',
      },
    },
  ]
  for (const { request, expand } of planRestyle(doc, STANDARD_TYPOGRAPHY).requests) {
    // Use the existing planner's per-paragraph table ranges directly, avoiding
    // a rejected cross-cell range and a recovery request during creation.
    if (expand) {
      for (const range of expand) {
        requests.push({ updateTextStyle: { ...(request.updateTextStyle as object), range } })
      }
    } else requests.push(request)
  }
  const tabs = flattenTabs(doc.tabs ?? [])
  const bodies = tabs.length
    ? tabs.map((tab) => ({ tabId: tab.tabProperties?.tabId, body: tab.documentTab?.body }))
    : [{ tabId: undefined, body: doc.body }]
  for (const { tabId, body } of bodies) {
    const outline = summarizeDocument({ body })
    for (const heading of outline.headings ?? []) {
      const startIndex = heading.startIndex
      const endIndex = Math.min(heading.endIndex ?? 0, (outline.endIndex ?? 1) - 1)
      if (startIndex === undefined || endIndex <= startIndex) continue
      requests.push({
        updateParagraphStyle: {
          range: { startIndex, endIndex, ...(tabId ? { tabId } : {}) },
          paragraphStyle: {
            spaceAbove: { magnitude: heading.style === 'TITLE' || startIndex === 1 ? 0 : 8, unit: 'PT' },
            spaceBelow: { magnitude: 4, unit: 'PT' },
            keepWithNext: true,
          },
          fields: 'spaceAbove,spaceBelow,keepWithNext',
        },
      })
    }
  }
  return requests
}

/** Apply the preset before the agent's first review; its normal final review still verifies the result. */
export async function applyCreationStyle(client: GoogleClient, fileId: string, progress?: (line: string) => void) {
  const doc = await fetchDoc<RawRestyleDocument>(client, fileId, 'title,revisionId,tabs', 'SUGGESTIONS_INLINE')
  if (!doc.revisionId) throw new Error('Google did not return an editable revision; no preset styling was applied.')
  let revisionId: string | undefined = doc.revisionId
  let applied = 0
  const batches = batchesOf(planCreationStyle(doc))
  for (const [index, requests] of batches.entries()) {
    if (!revisionId)
      throw new Error(
        'Some preset styling was applied, but its new revision is unavailable. Read the document before continuing.',
      )
    progress?.(`Styling "${doc.title ?? fileId}": batch ${index + 1}/${batches.length}`)
    const result = await batchUpdateDoc(client, fileId, requests, revisionId)
    applied += result.applied
    revisionId = result.revisionId
  }
  return { applied, batches: batches.length, revisionId }
}
