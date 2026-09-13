import { useEffect, useState } from 'react'
import { SETTINGS_PAGES, settingsHref, type SettingsGroup, type SettingsSection } from './settingsRoutes.ts'

const GROUPS: Array<{ label: SettingsGroup; pages: SettingsSection[] }> = [
  { label: 'Me', pages: ['about-me', 'writing-voice'] },
  { label: 'AI', pages: ['models', 'voice', 'prompts'] },
]

export function SettingsNav({ section, navigate }: { section: SettingsSection; navigate: (path: string) => void }) {
  const [open, setOpen] = useState({ Me: true, AI: true })
  const group = SETTINGS_PAGES[section].group
  useEffect(() => {
    if (group) setOpen((current) => ({ ...current, [group]: true }))
  }, [group, section])
  const page = (id: SettingsSection) => (
    <button
      key={id}
      type="button"
      className="sky-thread sky-settings-link"
      data-active={section === id}
      aria-current={section === id ? 'page' : undefined}
      onClick={() => navigate(settingsHref(id))}
    >
      {SETTINGS_PAGES[id].label}
    </button>
  )
  return (
    <div className="sky-settings-nav" aria-label="Settings navigation">
      {page('appearance')}
      {GROUPS.map((item) => (
        <div className="sky-settings-group" key={item.label}>
          <div className="sky-settings-group-heading" data-current={group === item.label}>
            <button
              type="button"
              className="sky-settings-group-name"
              onClick={() => {
                setOpen((current) => ({ ...current, [item.label]: true }))
                navigate(settingsHref(item.pages[0]))
              }}
            >
              {item.label}
            </button>
            <button
              type="button"
              className="sky-settings-toggle"
              aria-label={`${open[item.label] ? 'Collapse' : 'Expand'} ${item.label}`}
              aria-expanded={open[item.label]}
              aria-controls={`settings-${item.label}`}
              onClick={() => setOpen((current) => ({ ...current, [item.label]: !current[item.label] }))}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
                data-open={open[item.label]}
              >
                <path
                  d="m6 4 4 4-4 4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
          <div id={`settings-${item.label}`} className="sky-settings-children" hidden={!open[item.label]}>
            {item.pages.map(page)}
          </div>
        </div>
      ))}
      <div className="sky-settings-group">
        {page('connections')}
        {page('notebook')}
      </div>
      <div className="sky-settings-footer">
        {page('advanced')}
        {page('about')}
      </div>
    </div>
  )
}
