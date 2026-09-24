import { loadSkyConfig } from '#shared/config/loader.ts'
import type { GoogleAccountCategory, SkyConfig } from '#shared/config/types.ts'

/**
 * The side of the day an account's saved mail is filed under: the one chosen
 * on the Google settings page, or Professional when none was, as before the
 * choice existed. The file is read on each call, so a change applies from the
 * next capture without a restart.
 */
export function accountCategory(
  email: string,
  config: Pick<SkyConfig, 'google'> = loadSkyConfig(),
): GoogleAccountCategory {
  return config.google?.accountCategories?.[email.trim().toLowerCase()] ?? 'Professional'
}
