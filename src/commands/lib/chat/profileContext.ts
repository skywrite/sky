import { readOptional } from '#lib/outbox/files.ts'

/** Read at session creation so About me edits apply to the next conversation. */
export async function profileContext(config: Record<string, unknown>): Promise<string> {
  if (typeof config.FILE_ABOUT_ME !== 'string') return ''
  const profile = (await readOptional(config.FILE_ABOUT_ME))?.trim()
  if (!profile) return ''
  return `## About the person you are helping\n\nThe user provided this profile to help you understand their background, responsibilities, and priorities. Use it when relevant.\n\n${profile.slice(0, 16_000)}`
}
