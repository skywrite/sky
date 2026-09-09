import { KNOWN_PROVIDERS, PROFILES, resolveProfile, type ModelProfile, type ResolvedModel } from '#shared/ai/models.ts'
import { loadSkyConfig } from '#shared/config/loader.ts'
import type { SkyConfig } from '#shared/config/types.ts'
import { WritingVoiceError } from './types.ts'

export const DEFAULT_WRITING_VOICE_PROFILE = 'default-fable-5.1-high'

/** Read both the selection and its definition on each call, including in existing chats. */
export function createWritingVoiceModel(
  load: () => Pick<SkyConfig, 'ai'> = loadSkyConfig,
  resolve: (profile: ModelProfile) => ResolvedModel = resolveProfile,
): () => ResolvedModel {
  return () => {
    const { ai } = load()
    const name = ai.writingVoiceProfile ?? DEFAULT_WRITING_VOICE_PROFILE
    const profiles = { ...PROFILES, ...ai.profiles }
    const profile = Object.hasOwn(profiles, name) ? profiles[name as keyof typeof profiles] : undefined
    if (
      !profile ||
      !(KNOWN_PROVIDERS as readonly string[]).includes(profile.provider) ||
      typeof profile.model !== 'string' ||
      !profile.model.trim()
    )
      throw new WritingVoiceError('Choose an available model configuration in Settings > Writing Voice.', 503)
    return resolve(profile as ModelProfile)
  }
}

export const writingVoiceModel = createWritingVoiceModel()
