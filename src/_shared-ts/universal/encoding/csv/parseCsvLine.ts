/**
 * Parse a single CSV line into an array of string fields.
 *
 * Handles:
 * - Comma-separated fields
 * - Quoted fields (preserves commas inside quotes)
 * - Escaped quotes ("" inside quoted fields becomes ")
 * - Whitespace trimming (outside quotes only)
 * - Mixed quoted and unquoted fields
 *
 * @param line - A single CSV line (no newlines)
 * @returns Array of field values as strings
 *
 * @example
 * ```ts
 * parseCsvLine('a,b,c')           // ['a', 'b', 'c']
 * parseCsvLine('"a,b",c')         // ['a,b', 'c']
 * parseCsvLine('"say ""hi""",b')  // ['say "hi"', 'b']
 * parseCsvLine(' a , b ')         // ['a', 'b']
 * parseCsvLine('"  a  ",b')       // ['  a  ', 'b']
 * ```
 */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let i = 0

  while (i <= line.length) {
    // Skip leading whitespace for this field
    while (i < line.length && (line[i] === ' ' || line[i] === '\t')) {
      i++
    }

    if (i >= line.length) {
      // End of line - add empty field if we just saw a comma
      fields.push('')
      break
    }

    if (line[i] === ',') {
      // Empty field
      fields.push('')
      i++
      continue
    }

    if (line[i] === '"') {
      // Quoted field - parse until closing quote
      i++ // skip opening quote
      let value = ''

      while (i < line.length) {
        if (line[i] === '"') {
          // Check for escaped quote ("")
          if (i + 1 < line.length && line[i + 1] === '"') {
            value += '"'
            i += 2
            continue
          }
          // End of quoted field
          i++ // skip closing quote
          break
        }
        value += line[i]
        i++
      }

      fields.push(value)

      // Skip trailing whitespace and find comma or end
      while (i < line.length && (line[i] === ' ' || line[i] === '\t')) {
        i++
      }
      if (i < line.length && line[i] === ',') {
        i++ // skip comma
      } else {
        break // end of line
      }
    } else {
      // Unquoted field - parse until comma
      let value = ''
      while (i < line.length && line[i] !== ',') {
        value += line[i]
        i++
      }
      fields.push(value.trim())

      if (i < line.length && line[i] === ',') {
        i++ // skip comma
      } else {
        break // end of line
      }
    }
  }

  return fields
}
