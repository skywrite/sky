export type Attachment = {
  file: string
  rel?: string[]
}

export function parseAttachments(raw: unknown): Attachment[] {
  if (!Array.isArray(raw)) return []

  return raw
    .filter(
      (item): item is Record<string, unknown> =>
        item != null && typeof item === 'object' && typeof item.file === 'string',
    )
    .map((item) => {
      const attachment: Attachment = { file: item.file as string }
      if (typeof item.rel === 'string') {
        attachment.rel = item.rel
          .split(',')
          .map((s: string) => s.trim())
          .filter((s: string) => s !== '')
      }
      return attachment
    })
}

export function attachmentsToYaml(attachments: Attachment[]): Record<string, unknown>[] {
  return attachments.map((a) => {
    const entry: Record<string, unknown> = { file: a.file }
    if (a.rel && a.rel.length > 0) {
      entry.rel = a.rel.join(', ')
    }
    return entry
  })
}
