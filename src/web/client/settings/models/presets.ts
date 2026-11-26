import { effectiveEffort, effortLabel, effortLevels, hasCustomEffort, presetEffort } from '#universal/ai/effort.ts'
import { prettyModel } from '#universal/ai/modelName.ts'
import type { ProfileRow } from '../settings.tsx'
import type { ModelIconName } from './ModelIcon.tsx'

const roles: Record<string, { icon: ModelIconName; example: string }> = {
  chat: { icon: 'chat', example: 'The starting model for a new conversation. Each chat can choose its own.' },
  frontier: { icon: 'frontier', example: 'Weekly summaries and check-ins' },
  reasoning: { icon: 'thinking', example: 'Daily summaries, decisions, and planning' },
  fast: { icon: 'quick', example: 'Short labels, titles, and summaries' },
  balanced: { icon: 'balanced', example: 'Linking notes and organizing information' },
  vision: { icon: 'vision', example: 'Reading images and screenshots' },
}

export const roleInfo = (role: string) => roles[role] ?? { icon: 'layers' as const, example: '' }
export const roleLabel = (label: string) => (label === 'Chat' ? 'New chats' : label)

export function serviceTier(profile: ProfileRow): string {
  const tier = profile.options?.serviceTier
  return typeof tier === 'string' ? tier.charAt(0).toUpperCase() + tier.slice(1) : ''
}

export function presetTitle(profile: ProfileRow): string {
  return profile.builtin || profile.overrides
    ? [prettyModel(profile.model), serviceTier(profile)].filter(Boolean).join(' · ')
    : profile.name
}

export function effortText(profile: ProfileRow, full = false): string {
  if (hasCustomEffort(profile)) return 'Custom effort'
  const level = effectiveEffort(profile)
  return level ? effortLabel(level) + (full ? ' effort' : '') : 'Model default'
}

/** Provider-specific and fixed effort values belong to the advanced options editor. */
export function editableEffort(profile: ProfileRow) {
  return hasCustomEffort(profile) || effortLevels(profile).length < 2 ? undefined : presetEffort(profile)
}
