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

/**
 * Prior attachments first, then additions whose `file` is new — a file
 * recorded twice (a resumed chat re-reading its document) keeps one entry.
 */
export function mergeAttachments(
  prior: readonly Attachment[] | undefined,
  added: readonly Attachment[] | undefined,
): Attachment[] {
  const merged: Attachment[] = [...(prior ?? [])]
  const seen = new Set(merged.map((a) => a.file))
  for (const attachment of added ?? []) {
    if (seen.has(attachment.file)) continue
    seen.add(attachment.file)
    merged.push(attachment)
  }
  return merged
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
