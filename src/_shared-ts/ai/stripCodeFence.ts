/**
 * Strip a code fence wrapping an ENTIRE model output.
 *
 * Models sometimes wrap a whole markdown response in ```markdown ... ``` even
 * when the prompt asks for raw markdown. Only the whole-document wrap is
 * removed: the first non-blank line must be a fence opener with no tag or a
 * markdown tag (```, ```markdown, ```md) and the last non-blank line must be
 * a bare closing fence. Fences inside the body — real code blocks — are left
 * untouched, and an opener naming a language (```js) is treated as content.
 */
export function stripWrappingCodeFence(text: string): string {
  const trimmed = text.trim()
  const lines = trimmed.split('\n')
  if (lines.length < 2) return trimmed
  const opener = lines[0].trim()
  const closer = lines[lines.length - 1].trim()
  if (!/^```(markdown|md)?$/.test(opener) || closer !== '```') return trimmed
  return lines.slice(1, -1).join('\n').trim()
}
