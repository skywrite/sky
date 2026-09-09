const drafts = new Map<string, string>()

/** A page can offer a conversation in the composer; sending remains the person's action. */
export function stageChatDraft(id: string, text: string): void {
  drafts.set(id, text)
}

export function takeChatDraft(id: string): string | undefined {
  const draft = drafts.get(id)
  drafts.delete(id)
  return draft
}
