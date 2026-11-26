import type { SettingsGroup, SettingsSection } from './settingsRoutes.ts'

/**
 * The Settings home a phone opens: every settings page once, grouped as the sidebar
 * groups them. Quiet sections are the ones the sidebar dims at its foot.
 */
export const HOME_SECTIONS: ReadonlyArray<{
  heading: SettingsGroup | null
  pages: readonly SettingsSection[]
  quiet?: boolean
}> = [
  { heading: null, pages: ['appearance'] },
  { heading: 'Me', pages: ['about-me', 'writing-voice'] },
  { heading: 'AI', pages: ['models', 'transcription', 'voice', 'prompts'] },
  { heading: null, pages: ['connections', 'browser-automation', 'extensions', 'notebook'] },
  { heading: null, pages: ['advanced', 'experimental', 'about'], quiet: true },
]

/**
 * Where a home row goes. Appearance's own address is `/settings`, which is the home itself
 * on a phone, so its row uses the page's other address.
 */
export function homeRowHref(section: SettingsSection, href: string): string {
  return section === 'appearance' ? '/settings/appearance' : href
}
