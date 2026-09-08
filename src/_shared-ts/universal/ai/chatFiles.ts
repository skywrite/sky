/** Upload limits and the ordinary markdown links kept on a chat's user turn. */
export const MAX_CHAT_FILE_BYTES = 20 * 1024 * 1024
export const MAX_CHAT_FILES = 10

export interface ChatFileRef {
  name: string
  url: string
}

export function chatFileError(files: readonly { name: string; size: number }[]): string | null {
  if (files.length > MAX_CHAT_FILES) return `Attach up to ${MAX_CHAT_FILES} files at a time.`
  const empty = files.find((file) => file.size === 0)
  if (empty) return `${empty.name} is empty.`
  if (files.reduce((total, file) => total + file.size, 0) > MAX_CHAT_FILE_BYTES)
    return 'Attachments must total 20 MB or less.'
  return null
}

export function withChatFiles(message: string, files: readonly ChatFileRef[]): string {
  const links = files.map(({ name, url }) => `[📎 ${name.replace(/[\\[\]]/g, '\\$&')}](${url})`)
  return [message.trim(), ...links].filter(Boolean).join('\n\n')
}

/** Only trailing attachment links are clips; the person's other markdown stays verbatim. */
export function splitChatFiles(message: string): { text: string; files: ChatFileRef[] } {
  let text = message.trimEnd()
  const files: ChatFileRef[] = []
  const link = /(?:^|\n\n)\[📎 ((?:\\.|[^\]\\\n])*)\]\((\/chat\/files\/\d{4}-\d{2}-\d{2}\/[^\s/()?#]+)\)$/
  for (let match = link.exec(text); match; match = link.exec(text)) {
    files.unshift({ name: match[1]!.replace(/\\([\\[\]])/g, '$1'), url: match[2]! })
    text = text.slice(0, match.index).trimEnd()
  }
  return { text, files }
}
