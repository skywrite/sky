/**
 * Extract the first complete JSON object or array from a text response.
 * Handles cases where the AI returns JSON followed by additional reasoning text.
 */
export function extractJSON(text: string): string {
  // First, strip markdown code fences if present
  text = text
    .replace(/^```json\s*\n?/i, '')
    .replace(/\n?```\s*$/, '')
    .trim()

  // Try parsing as-is first
  try {
    JSON.parse(text)
    return text
  } catch {
    // If that fails, extract the first complete JSON structure using bracket/brace counting
    // Look for either { (object) or [ (array)
    let count = 0
    let startIdx = -1
    let endIdx = -1
    let openChar = ''
    let closeChar = ''

    for (let i = 0; i < text.length; i++) {
      const char = text[i]

      if ((char === '{' || char === '[') && count === 0) {
        startIdx = i
        openChar = char
        closeChar = char === '{' ? '}' : ']'
        count = 1
      } else if (char === openChar && count > 0) {
        count++
      } else if (char === closeChar && count > 0) {
        count--
        if (count === 0) {
          endIdx = i
          break
        }
      }
    }

    if (startIdx !== -1 && endIdx !== -1) {
      const extracted = text.substring(startIdx, endIdx + 1)
      // Validate the extracted JSON
      try {
        JSON.parse(extracted)
        return extracted
      } catch {
        throw new Error(
          `Failed to parse extracted JSON from Claude response. First 500 chars:\n${text.substring(0, 500)}`,
        )
      }
    }

    throw new Error(`Failed to find valid JSON in Claude response. First 500 chars:\n${text.substring(0, 500)}`)
  }
}
