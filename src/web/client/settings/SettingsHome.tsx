import type { MouseEvent } from 'react'
import { prettyModel } from '#universal/ai/modelName.ts'
import { HOME_SECTIONS, homeRowHref } from './homeSections.ts'
import { type SettingsData, useSettings } from './settings.tsx'
import { SETTINGS_PAGES, type SettingsSection } from './settingsRoutes.ts'

const THEME_LABEL: Record<SettingsData['theme'], string> = { system: 'System', light: 'Light', dark: 'Dark' }

/** The current choice a row shows beside its name, where one helps. */
function valueOf(section: SettingsSection, data: SettingsData | null): string | null {
  if (!data) return null
  if (section === 'appearance') return THEME_LABEL[data.theme] ?? null
  if (section === 'models') {
    const chat = data.models.find((row) => row.role === 'chat')
    const preset = chat && data.profiles.find((profile) => profile.name === chat.profile)
    return preset ? prettyModel(preset.model) : null
  }
  return null
}

/**
 * Settings on a phone: every section as a list to read at a glance. Each row opens the
 * section's own page, whose back button returns here. A wide screen shows the sidebar's
 * list beside Appearance instead.
 */
export function SettingsHome({ navigate }: { navigate: (to: string) => void }) {
  const { data } = useSettings()
  return (
    <div className="sky-main" data-settings-section="home">
      <div className="sky-scroll">
        <div className="sky-col sky-set">
          <div className="sky-set-heading">
            <h1>Settings</h1>
          </div>
          {HOME_SECTIONS.map((section) => (
            <section key={section.pages[0]} aria-label={section.heading ?? undefined}>
              {section.heading && <h2 className="sky-list-heading">{section.heading}</h2>}
              <div className="sky-list">
                {section.pages.map((id) => {
                  const href = homeRowHref(id, SETTINGS_PAGES[id].href)
                  const value = valueOf(id, data)
                  return (
                    <a
                      key={id}
                      href={href}
                      className="sky-list-row"
                      data-quiet={section.quiet || undefined}
                      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                        if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
                        event.preventDefault()
                        navigate(href)
                      }}
                    >
                      <span className="sky-list-label">{SETTINGS_PAGES[id].label}</span>
                      {value && <span className="sky-list-value">{value}</span>}
                    </a>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
