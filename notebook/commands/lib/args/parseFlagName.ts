export type ParsedFlagNameResult = [string, string] | [string]

/**
 * Strip value placeholders from a flag or arg definition.
 * Handles both required <value> and optional [value] placeholders.
 *
 * @example
 * stripValuePlaceholder('--from <date>') // '--from'
 * stripValuePlaceholder('-n, --limit <n>') // '-n, --limit'
 * stripValuePlaceholder('--file [path]') // '--file'
 */
export function stripValuePlaceholder(flag: string): string {
  return flag.replace(/\s+<[^>]+>/g, '').replace(/\s+\[[^\]]+\]/g, '')
}

export default function parseFlagName(flagNames: string): ParsedFlagNameResult {
  // e.g. '-w, --when' to ['when', 'w']
  // e.g. '--max-tokens' to ['max-tokens']
  // e.g. '-d, --days <n>' to ['days', 'd'] (strips value placeholder)
  const parts = flagNames.split(',').map((part) => part.trim())

  const names = parts
    .map((part) => {
      // Remove leading dashes and value placeholder (e.g., '<n>', '<value>', '[optional]')
      return part
        .replace(/^-+/, '')
        .replace(/\s+<[^>]+>$/, '')
        .replace(/\s+\[[^\]]+\]$/, '')
    })
    .reverse() // Reverse because CLI convention is short first (-w, --when) but we return long first

  // Long flag is always required and returned first, short flag is optional
  const res: ParsedFlagNameResult = [names[0]]

  if (names.length === 2) res.push(names[1])

  return res
}
