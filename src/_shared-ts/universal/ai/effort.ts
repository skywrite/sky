/** Shared by the registry and both UIs: effort is a preset default with a per-call override. */
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type Effort = (typeof EFFORTS)[number]
export type EffortOverride = Effort | 'default'

export interface EffortProfile {
  provider: string
  model: string
  options?: object
}

export function isEffort(value: unknown): value is Effort {
  return typeof value === 'string' && (EFFORTS as readonly string[]).includes(value)
}

export function isEffortOverride(value: unknown): value is EffortOverride {
  return value === 'default' || isEffort(value)
}

export function effortLabel(value: EffortOverride | null): string {
  return value === null || value === 'default'
    ? 'Default'
    : value === 'xhigh'
      ? 'X-high'
      : value[0].toUpperCase() + value.slice(1)
}

export function presetEffort(profile: EffortProfile): Effort | null {
  const value = (profile.options as Record<string, unknown> | undefined)?.[
    profile.provider === 'anthropic' ? 'effort' : 'reasoningEffort'
  ]
  return isEffort(value) ? value : null
}

/** Only advertise levels the model accepts; an unfamiliar model keeps its existing options. */
export function effortLevels(profile: EffortProfile): readonly Effort[] {
  if (profile.provider === 'anthropic') {
    // https://platform.claude.com/docs/en/build-with-claude/effort
    if (/^claude-(?:opus-(?:5|4-[78])|sonnet-5|fable-5(?:-1)?|mythos-5(?:-1)?)(?:$|-\d{8}$)/.test(profile.model))
      return EFFORTS
    if (/^claude-(?:opus|sonnet)-4-6(?:$|-\d{8}$)/.test(profile.model)) return ['low', 'medium', 'high', 'max']
  }
  // https://developers.openai.com/api/docs/models/gpt-6-astra
  if (profile.provider === 'openai' && /^gpt-6-astra(?:$|-)/.test(profile.model)) return EFFORTS
  const current = presetEffort(profile)
  return current ? [current] : []
}

export function validateEffort(profile: EffortProfile, value: unknown): asserts value is EffortOverride {
  if (!isEffortOverride(value)) throw new Error(`Effort must be default, ${EFFORTS.join(', ')}.`)
  if (value !== 'default' && !effortLevels(profile).includes(value)) {
    throw new Error(
      `${profile.model} does not support ${value} effort. Choose the preset default${effortLevels(profile).length ? ` or ${effortLevels(profile).join(', ')}` : ''}.`,
    )
  }
  if (
    profile.provider === 'anthropic' &&
    (value === 'xhigh' || value === 'max') &&
    (profile.options as { thinking?: { type?: string } } | undefined)?.thinking?.type === 'disabled'
  ) {
    throw new Error('Enable thinking before choosing X-high or Max effort.')
  }
}

/** Change only effort; provider options such as service tier and thinking stay intact. */
export function optionsWithEffort(profile: EffortProfile, effort: Effort | null): Record<string, unknown> {
  if (effort !== null) validateEffort(profile, effort)
  const options: Record<string, unknown> = { ...profile.options }
  delete options.effort
  delete options.reasoningEffort
  if (effort !== null) options[profile.provider === 'anthropic' ? 'effort' : 'reasoningEffort'] = effort
  return options
}
