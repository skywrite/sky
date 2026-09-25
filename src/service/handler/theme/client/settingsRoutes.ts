export const SETTINGS_PAGES = {
  appearance: {
    label: 'Appearance',
    href: '/settings',
    group: null,
    description: 'Make Sky feel comfortable, from the light in the room to the size of the text.',
  },
  'about-me': {
    label: 'About me',
    href: '/settings/me',
    group: 'Me',
    description: 'Tell Sky about yourself. A little context helps it understand what matters to you.',
  },
  'writing-voice': {
    label: 'Writing style',
    href: '/settings/me/writing-style',
    group: 'Me',
    description: 'Help Sky write in your voice, with your preferences and examples it can learn from.',
  },
  models: {
    label: 'Models',
    href: '/settings/ai/models',
    group: 'AI',
    description: 'The models Sky uses to think, write, and understand your world.',
  },
  voice: {
    label: 'Voice',
    href: '/settings/ai/voice',
    group: 'AI',
    description: 'Choose how Sky and Sonny sound when you talk together.',
  },
  prompts: {
    label: 'Prompts',
    href: '/settings/ai/prompts',
    group: 'AI',
    description: 'Find a prompt, see where it’s used, and make it yours.',
  },
  connections: {
    label: 'Connections',
    href: '/settings/connections',
    group: null,
    description: 'Connect the accounts and services that help Sky work with you.',
  },
  notebook: {
    label: 'Notebook',
    href: '/settings/notebook',
    group: null,
    description: 'Your notes, files, and the tools you use with them.',
  },
  advanced: {
    label: 'Advanced',
    href: '/settings/advanced',
    group: null,
    description: 'Inspect your configuration and where each setting comes from.',
  },
  experimental: {
    label: 'Experimental',
    href: '/settings/experimental',
    group: null,
    description: 'Features still taking shape. Try them early, and expect them to change.',
  },
  about: {
    label: 'About Sky',
    href: '/settings/about',
    group: null,
    description: 'Your version of Sky and the service keeping everything in sync.',
  },
} as const

export type SettingsSection = keyof typeof SETTINGS_PAGES
export type SettingsGroup = 'Me' | 'AI'

export function settingsHref(section: SettingsSection): string {
  return SETTINGS_PAGES[section].href
}

export function settingsSectionOf(path: string): SettingsSection | null {
  if (path !== '/settings' && !path.startsWith('/settings/')) return null
  const clean = path.replace(/\/$/, '')
  for (const [id, page] of Object.entries(SETTINGS_PAGES)) {
    if (clean === page.href || ((id === 'prompts' || id === 'connections') && clean.startsWith(`${page.href}/`)))
      return id as SettingsSection
  }
  if (clean === '/settings/ai') return 'models'
  if (clean === '/settings/appearance') return 'appearance'
  if (clean === '/settings/about-me' || clean === '/settings/me/about') return 'about-me'
  if (clean === '/settings/voice') return 'voice'
  if (clean === '/settings/writing-voice') return 'writing-voice'
  if (clean === '/settings/prompts' || clean.startsWith('/settings/prompts/')) return 'prompts'
  return 'appearance'
}

/** The connections that have a page of their own under Connections. */
export const CONNECTION_PAGES = ['beeper', 'google'] as const
export type ConnectionPage = (typeof CONNECTION_PAGES)[number]

export function connectionHref(page: ConnectionPage): string {
  return `${settingsHref('connections')}/${page}`
}

export function connectionPageOf(path: string): ConnectionPage | null {
  const clean = path.replace(/\/$/, '')
  return CONNECTION_PAGES.find((page) => clean === connectionHref(page)) ?? null
}

export function promptHref(id?: string): string {
  return `${settingsHref('prompts')}${id ? `/${id.split('/').map(encodeURIComponent).join('/')}` : ''}`
}

export function promptIdOf(path: string): string | null {
  for (const root of [settingsHref('prompts'), '/settings/prompts']) {
    if (!path.startsWith(`${root}/`)) continue
    try {
      return decodeURIComponent(path.slice(root.length + 1))
    } catch {
      return null
    }
  }
  return null
}
