import { assert, test } from '#test'
import { HOME_SECTIONS, homeRowHref } from './homeSections.ts'
import { SETTINGS_PAGES, type SettingsSection, settingsSectionOf } from './settingsRoutes.ts'

const listed = HOME_SECTIONS.flatMap((section) => section.pages)

test('the Settings home lists every settings page exactly once', () => {
  assert({
    given: 'the Settings home a phone opens',
    should: 'list each settings page once, so a new page cannot go missing from it',
    actual: [...listed].sort(),
    expected: (Object.keys(SETTINGS_PAGES) as SettingsSection[]).sort(),
  })
})

test('every Settings home row opens the page it names', () => {
  assert({
    given: 'the address behind each row',
    should: 'resolve to that row’s page',
    actual: listed.map((section) => settingsSectionOf(homeRowHref(section, SETTINGS_PAGES[section].href))),
    expected: listed,
  })
  assert({
    given: 'the Appearance row',
    should: 'use an address other than /settings, which is the home itself on a phone',
    actual: homeRowHref('appearance', SETTINGS_PAGES.appearance.href),
    expected: '/settings/appearance',
  })
})
