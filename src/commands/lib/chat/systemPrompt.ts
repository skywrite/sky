import { formatPeopleBlock, gatherPeopleEntities } from '#commands/all/ai/context/_entityContext.ts'
import { LEGAL_REVIEW_CHAT_INSTRUCTIONS } from '#lib/legalReview/chat.ts'
import type { SecretsProvider } from '#lib/secrets/SecretsProvider.ts'
import { WRITING_VOICE_CHAT_INSTRUCTIONS } from '#lib/writingVoice/tools.ts'
/**
 * The base system prompt for a chat session, rendered once per session so
 * it stays byte-identical and prompt-cached: the interaction-ranked people
 * list for grounding, and the standing preference memories — read straight
 * from disk, not the service, so resumed sessions get them too and a
 * service outage costs context documents, never the standing preferences.
 * Every host renders it here, so two hosts cannot prompt the model
 * differently.
 */
import { loadMemories, renderPreferenceBlock } from '#shared/models/Memory/mod.ts'
import { readPromptFile } from '#shared/prompts/load.ts'
import { type RenderInput, renderPromptFile } from '#shared/prompts/mod.ts'
import { googleAccountsBlock } from './googleAccounts.ts'
import { profileContext } from './profileContext.ts'

const PROMPT_FILE = new URL('./prompts/chat.prompt.md', import.meta.url).pathname

export interface ChatSystemPromptInput {
  /** Notebook config — the people stores read DIR_PEOPLE and DIR_PEOPLE_OLD, the Google accounts block DIR_ORGS */
  config: Record<string, unknown>
  clock: RenderInput['context']
  memoryDir: string
  /** The keychain the connected Google accounts are listed from; without it the prompt names none */
  secrets?: SecretsProvider
}

export async function renderChatSystemPrompt(
  input: ChatSystemPromptInput,
): Promise<{ prompt: string; peopleCount: number }> {
  const [people, memories, template, profile, google] = await Promise.all([
    gatherPeopleEntities(input.config),
    loadMemories(input.memoryDir),
    readPromptFile(PROMPT_FILE),
    profileContext(input.config),
    input.secrets
      ? googleAccountsBlock({ secrets: input.secrets, orgsDir: input.config.DIR_ORGS as string | undefined })
      : '',
  ])
  const { output } = renderPromptFile(template, 'chat.prompt.md', {
    context: input.clock,
    entities: { block: formatPeopleBlock(people) },
    memory: { block: renderPreferenceBlock(memories) },
    google: { block: google },
  })
  return {
    prompt: [output, profile, WRITING_VOICE_CHAT_INSTRUCTIONS, LEGAL_REVIEW_CHAT_INSTRUCTIONS]
      .filter(Boolean)
      .join('\n\n'),
    peopleCount: people.length,
  }
}
