/** Presentation metadata shared by web and CLI chat; keys remain the model-facing tool IDs. */
const TOOL_PRESENTATION: Readonly<Record<string, { displayName: string }>> = {
  me_voice: { displayName: 'Ghostwriter' },
  ai_research: { displayName: 'AI Research' },
  ai_image: { displayName: 'AI Image' },
  google_agent: { displayName: 'Google Agent' },
  legal_review: { displayName: 'Legal Review' },
}

const ACRONYMS = new Set(['ai', 'api', 'id', 'pdf', 'srt', 'url'])

/** Resolve labels at render time, so saved calls also use the current name. */
export function toolDisplayName(toolName: string): string {
  const presentation = Object.hasOwn(TOOL_PRESENTATION, toolName) ? TOOL_PRESENTATION[toolName] : undefined
  return (
    presentation?.displayName ??
    toolName
      .split(/[_: ]+/)
      .map((word) => (ACRONYMS.has(word) ? word.toUpperCase() : word.replace(/^\p{L}/u, (c) => c.toUpperCase())))
      .join(' ')
  )
}
