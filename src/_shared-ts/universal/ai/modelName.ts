/** claude-opus-5-5 → Claude Opus 5.5 · claude-haiku-5-5 → Claude Haiku 5.5 · gpt-5.5 → GPT 5.5 */
export function prettyModel(id: string): string {
  const joined = id
    .split(/[-/]/)
    .map((part) => {
      if (/^gpt/i.test(part)) return part.toUpperCase()
      if (/^\d/.test(part)) return part
      return part.charAt(0).toUpperCase() + part.slice(1)
    })
    .join(' ')
  return joined.replace(/ (\d+) (\d+)$/, ' $1.$2')
}
