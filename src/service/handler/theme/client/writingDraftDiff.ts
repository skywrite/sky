import { diffWordsWithSpace } from 'diff'
import { escapeHtml } from './wysiwyg/html.ts'

/** Read from the current draft to the selected version: what restoring it would change. */
export function writingDraftDiffHtml(current: string, selected: string): string {
  // A wholesale rewrite should not tie up the page looking for tiny word matches.
  const changes: { value: string; added?: boolean; removed?: boolean }[] = diffWordsWithSpace(current, selected, {
    maxEditLength: 800,
    timeout: 40,
  }) ?? [
    { value: current, removed: true },
    { value: selected, added: true },
  ]
  let html = ''
  let removedText = ''
  let addedText = ''
  const flush = () => {
    if (removedText) html += `<del>${escapeHtml(removedText)}</del>`
    if (addedText) html += `<ins>${escapeHtml(addedText)}</ins>`
    removedText = ''
    addedText = ''
  }
  for (const [index, change] of changes.entries()) {
    if (change.removed) removedText += change.value
    else if (change.added) addedText += change.value
    else {
      const next = changes[index + 1]
      // Shared spaces inside a replaced phrase belong in both readings.
      if ((removedText || addedText) && /^\s+$/.test(change.value) && (next?.added || next?.removed)) {
        removedText += change.value
        addedText += change.value
      } else {
        flush()
        html += escapeHtml(change.value)
      }
    }
  }
  flush()
  return html
}
