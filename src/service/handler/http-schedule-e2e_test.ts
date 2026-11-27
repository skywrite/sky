import { spyOn } from 'bun:test'
import { mkdir, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { MockLanguageModelV4 } from 'ai/test'
import { defaultAvailabilityTemplate, defaultDayLineStyle } from '#lib/calendarScheduler/availabilityMessage.ts'
import type { CalendarEvent } from '#lib/google/calendar.ts'
import * as models from '#shared/ai/models.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { calendarInterval, PlainDate, PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

const modelReturning = (text: string) =>
  new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: 'text', text }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    },
  })

test(
  {
    name: 'schedule shows the daily agenda and copies the saved template with only selected, verified openings',
    timeout: 60000,
  },
  async (t) => {
    const today = PlainDate.today()
    const monday = today.addDays(8 - today.dayOfWeek)
    const dates = [monday.ymd, monday.addDays(1).ymd, monday.addDays(2).ymd]
    const timezone = 'America/Chicago'
    const request =
      'Meet Jane on Monday, Tuesday, or Wednesday afternoon. Leave 15 minutes between meetings. Show times in Pacific.'
    const search = {
      dates,
      startTime: '12:00',
      endTime: '17:00',
      timezone,
      displayTimezone: 'America/Los_Angeles',
      bufferMinutes: 15,
      minimumMinutes: 1,
      startMinutes: [],
      clarification: '',
    }
    const calendarEvent = (date: string, time: string, minutes: number, title: string): CalendarEvent => {
      const { start, end } = calendarInterval(new PlainDateTime({ date, time }), timezone, minutes)
      return {
        id: start,
        start,
        end,
        account: 'jane@example.com',
        title,
        attendees: [],
        eventType: 'default',
        allDay: false,
        status: 'confirmed',
      }
    }
    const events: CalendarEvent[] = [
      calendarEvent(dates[0]!, '08:15', 30, 'Studio planning'),
      calendarEvent(dates[0]!, '13:30', 60, 'Design review'),
      calendarEvent(dates[1]!, '11:30', 135, 'Project kickoff'),
      calendarEvent(dates[2]!, '11:45', 180, 'Team workshop'),
      { ...calendarEvent(dates[2]!, '15:30', 30, 'Optional office hours'), transparency: 'transparent' },
      ...dates.map((date, i) => ({
        ...calendarEvent(date, '14:00', i === 1 ? 60 : 30, 'Open studio'),
        transparency: 'transparent',
      })),
      {
        ...calendarEvent(dates[1]!, '08:00', 60, 'Office day'),
        start: dates[1]!,
        end: dates[2]!,
        allDay: true,
        eventType: 'workingLocation',
      },
    ]
    const parser = spyOn(models, 'aiModelByProfile').mockReturnValue({ model: modelReturning(JSON.stringify(search)) })
    const fast = spyOn(models, 'aiModel').mockReturnValue({
      model: modelReturning('Here are my openings ({{timezone}}).\n\n{{days}}\n\nWhat works for you?'),
    })
    let incomplete = false
    let sends = 0
    try {
      await runWysiwygE2e(
        t,
        {
          initialMarkdown: '# Test notebook\n',
          tempPrefix: 'sky-find-time-',
          day: true,
          meetings: (dir) => ({
            dir: path.join(dir, 'meetings'),
            setup: async () => ({ date: today.ymd, timezone, accounts: ['jane@example.com'] }),
            people: async () => [],
            parse: async () => ({
              fields: {
                title: 'Meet Jane',
                date: dates[0]!,
                time: '13:00',
                timezone,
                duration: 30,
                account: '',
                guests: [],
                description: '',
              },
              invitees: [],
              assumptions: [],
              questions: [],
              unsupported: [],
            }),
            readCalendars: async () => ({
              sources: [
                { id: 'work', label: 'Work', events: events.filter((event) => event.title !== 'Design review') },
                {
                  id: 'personal',
                  label: 'Personal',
                  events: incomplete ? [] : events.filter((event) => event.title === 'Design review'),
                  warning: incomplete ? 'Could not check Personal.' : undefined,
                },
              ],
              warnings: [],
            }),
            availability: async (timing) => ({
              ...timing,
              events: [],
              calendars: ['Work'],
              warnings: [],
              alternatives: [],
              reviewKey: 'a'.repeat(64),
            }),
            create: async () => {
              sends++
              throw new Error('An availability search must not create an event.')
            },
          }),
        },
        async ({ page, origin, errors, userDataDir }) => {
          const legacy = 'My openings in {{timezone}}.\n\n{{days}}\n\nDoes one work for you?'
          const meetingsDir = path.join(userDataDir, 'meetings')
          await mkdir(meetingsDir, { recursive: true })
          await writeFile(path.join(meetingsDir, 'availability-template.txt'), legacy)
          await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin })
          await page.setViewportSize({ width: 1440, height: 1100 })
          await page.goto(origin + '/clock')
          await page.getByRole('button', { name: 'Schedule Meeting', exact: true }).click()
          const prompt = page.getByLabel('What are we scheduling?')
          assert({
            given: 'the Clock entry point',
            should: 'open the booking page with the composer focused',
            actual: [new URL(page.url()).pathname, await prompt.evaluate((input) => input === document.activeElement)],
            expected: ['/schedule', true],
          })
          await prompt.fill(request)
          await page.getByLabel('Meeting title', { exact: true }).fill('Reviewed title')
          await page.getByRole('tab', { name: 'Find a time' }).click()
          const query = page.getByLabel('Describe the availability you want to share')
          const preview = page.getByLabel('Message preview', { exact: true })
          const previewStarts = (prefix: string) =>
            page.waitForFunction(
              (value) =>
                document
                  .querySelector<HTMLTextAreaElement>('textarea[aria-label="Message preview"]')
                  ?.value.startsWith(value),
              prefix,
            )
          await previewStarts('Here are my openings')
          const agenda = page.getByRole('region', { name: 'Your availability' })
          const columns = agenda.locator('.sky-find-day')
          const mondayColumn = columns.first()
          const afternoon = mondayColumn.getByRole('button', { name: '12:45–3 pm', exact: true })
          const planning = mondayColumn.getByRole('group', { name: 'Busy calendar event' }).filter({
            has: page.getByRole('heading', { name: 'Studio planning', exact: true }),
          })
          const kickoff = columns
            .nth(1)
            .getByRole('group', { name: 'Busy calendar event' })
            .filter({
              has: page.getByRole('heading', { name: 'Project kickoff', exact: true }),
            })
          assert({
            given: 'three requested afternoons with calendar events',
            should: 'show each title and its full Pacific time on the right day, including morning and free events',
            actual: [
              await planning.getByText('6:15–6:45 am', { exact: true }).count(),
              await mondayColumn.getByRole('heading', { name: 'Design review', exact: true }).count(),
              await kickoff.getByText('9:30–11:45 am', { exact: true }).count(),
              await columns.nth(2).getByText('Optional office hours', { exact: true }).count(),
              await columns.nth(2).getByText('1:30–2 pm · Shows as free', { exact: true }).count(),
              await agenda.locator('input[type="checkbox"], [role="checkbox"]').count(),
            ],
            expected: [1, 1, 1, 1, 1, 0],
          })
          const screenshots = env.get('SKY_SCHEDULE_SCREENSHOTS')
          const grid = agenda.getByRole('region', { name: 'Calendar time grid' })
          const noonBlocks = grid.getByRole('group', { name: 'Calendar event marked free' }).filter({
            has: page.getByRole('heading', { name: 'Open studio', exact: true }),
          })
          const bounds = await noonBlocks.evaluateAll((cards) =>
            cards.map((card) => {
              const rect = card.parentElement!.getBoundingClientRect()
              const title = card.querySelector('h4')!
              const titleVisible = title.clientHeight >= Math.floor(parseFloat(getComputedStyle(title).lineHeight))
              return { top: rect.top, height: rect.height, left: rect.left, titleVisible }
            }),
          )
          const noonTick = await grid.locator('[data-hour="12"]').boundingBox()
          const review = await mondayColumn
            .getByRole('group', { name: 'Busy calendar event' })
            .filter({
              has: page.getByRole('heading', { name: 'Design review', exact: true }),
            })
            .boundingBox()
          assert({
            given: 'noon appointments across three days with different agendas and one all-day entry',
            should: 'align all starts to the noon tick, double the height for an hour, and place overlaps side by side',
            actual: [
              bounds.length,
              bounds.every((box) => Math.abs(box.top - (noonTick!.y + noonTick!.height / 2)) < 1),
              bounds.every((box) => box.titleVisible),
              Math.abs(bounds[1]!.height - 2 * bounds[0]!.height) < 1,
              review!.x + review!.width <= bounds[0]!.left + 1,
              await columns.nth(1).getByRole('heading', { name: 'Office day' }).count(),
            ],
            expected: [3, true, true, true, true, 1],
          })
          const firstMessage = await preview.inputValue()
          const reviewEvent = mondayColumn.getByRole('button', { name: /^Review Design review,/ })
          const wholeAfternoon = mondayColumn.getByRole('button', { name: '10 am–3 pm', exact: true })
          await reviewEvent.click()
          await page.getByRole('button', { name: 'Ignore this occurrence' }).click()
          await wholeAfternoon.waitFor()
          await page.getByRole('button', { name: 'Copy availability' }).click()
          assert({
            given: 'a busy appointment ignored from its details',
            should: 'keep it visible for undo and offer the released time and buffer in the copied message',
            actual: [
              await mondayColumn
                .getByRole('group', { name: 'Ignored calendar event' })
                .getByText('Design review')
                .count(),
              (await page.evaluate(() => navigator.clipboard.readText())).includes(': 10 am–3 pm'),
            ],
            expected: [1, true],
          })
          await reviewEvent.click()
          await page.getByRole('button', { name: 'Count as busy' }).click()
          await afternoon.waitFor()
          const picker = page.getByRole('button', { name: /^Calendars, / })
          const personal = page.getByRole('button', { name: 'Personal', exact: true })
          const work = page.getByRole('button', { name: 'Work', exact: true })
          await picker.click()
          await personal.click()
          await wholeAfternoon.waitFor()
          await work.click()
          await page.getByText('All calendars are off. Showing your requested hours.').waitFor()
          assert({
            given: 'all calendars explicitly switched off',
            should: 'show the requested windows with every calendar still available to turn back on',
            actual: [
              await agenda.locator('.sky-find-event').count(),
              await wholeAfternoon.getAttribute('aria-pressed'),
              await personal.getAttribute('aria-pressed'),
            ],
            expected: [0, 'true', 'false'],
          })
          await work.click()
          await planning.waitFor()
          assert({
            given: 'one calendar enabled again',
            should: 'keep its events out of the grid and preserve the other calendar',
            actual: [await reviewEvent.count(), await planning.count(), await picker.getAttribute('aria-label')],
            expected: [0, 1, 'Calendars, 1 of 2 on'],
          })
          await personal.click()
          await page.keyboard.press('Escape')
          await afternoon.waitFor()
          await previewStarts('Here are my openings')
          await planning.click()
          await page.keyboard.press('Escape')
          assert({
            given: 'a flexible request on the other tab',
            should: 'show all three days, both Monday windows on one bullet and the requested display zone',
            actual: [
              await query.inputValue(),
              firstMessage.includes('Pacific'),
              firstMessage.split('\n').filter((line) => line.startsWith('•')).length,
              firstMessage.includes(': 10–11:15 am or 12:45–3 pm'),
              (await preview.inputValue()) === firstMessage,
              await afternoon.getByText('Proposed', { exact: true }).isVisible(),
              fast.mock.calls.some(([role]) => role === 'fast'),
              await page.title(),
            ],
            expected: [request, true, 3, true, true, true, true, 'sky · Find a time'],
          })
          await afternoon.press('Space')
          assert({
            given: 'a highlighted opening toggled with the keyboard',
            should: 'mark it available and update the email immediately',
            actual: [await afternoon.getAttribute('aria-pressed'), (await preview.inputValue()).includes('12:45–3 pm')],
            expected: ['false', false],
          })
          await reviewEvent.click()
          await page.getByRole('button', { name: 'Ignore this occurrence' }).click()
          await wholeAfternoon.waitFor()
          assert({
            given: 'ignoring a reminder merges a proposed opening with time deliberately switched off',
            should: 'keep the combined opening out of the email until explicitly proposed',
            actual: [
              await wholeAfternoon.getAttribute('aria-pressed'),
              (await preview.inputValue()).includes('10 am–3 pm'),
            ],
            expected: ['false', false],
          })
          await reviewEvent.click()
          await page.getByRole('button', { name: 'Count as busy' }).click()
          await afternoon.waitFor()
          assert({
            given: 'restoring the reminder splits that opening again',
            should: 'restore the original proposal choices on both sides of the meeting',
            actual: [
              await mondayColumn.getByRole('button', { name: '10–11:15 am' }).getAttribute('aria-pressed'),
              await afternoon.getAttribute('aria-pressed'),
            ],
            expected: ['true', 'false'],
          })
          await afternoon.press('Enter')
          await mondayColumn.getByRole('button', { name: '12:45–3 pm', pressed: true }).click()
          const palette = await mondayColumn.evaluate((column) => {
            const fill = (selector: string) => getComputedStyle(column.querySelector(selector)!).backgroundColor
            const busy = fill('[data-kind="busy"]')
            const proposed = fill('button[aria-pressed="true"]')
            const neutral = fill('button[aria-pressed="false"]')
            const swatch = document.createElement('span')
            column.append(swatch)
            const token = (name: string) => {
              swatch.style.backgroundColor = `var(${name})`
              return getComputedStyle(swatch).backgroundColor
            }
            const gray = neutral === token('--sky-s2')
            const green = proposed === token('--sky-workstream-green-fill')
            const amber =
              getComputedStyle(column.querySelector('[data-kind="busy"]')!).borderInlineStartColor ===
              token('--sky-amber')
            swatch.remove()
            return [new Set([busy, proposed, neutral]).size, gray, green, amber]
          })
          assert({
            given: 'a day with a meeting, a proposed range and an excluded opening',
            should: 'show three distinct fills and give the excluded opening the neutral surface color',
            actual: palette,
            expected: [3, true, true, true],
          })
          if (screenshots) {
            await mkdir(screenshots, { recursive: true })
            await page.screenshot({ path: path.join(screenshots, 'schedule-desktop.png'), animations: 'disabled' })
            await page.setViewportSize({ width: 1440, height: 1400 })
            await agenda.screenshot({ path: path.join(screenshots, 'schedule-grid.png'), animations: 'disabled' })
            const theme = await page.locator('html').getAttribute('data-mantine-color-scheme')
            await page.evaluate(() => {
              document.documentElement.dataset.mantineColorScheme = 'dark'
            })
            await agenda.screenshot({ path: path.join(screenshots, 'schedule-dark.png'), animations: 'disabled' })
            await page.evaluate((theme) => {
              document.documentElement.dataset.mantineColorScheme = theme ?? 'light'
            }, theme)
            await page.setViewportSize({ width: 1440, height: 1100 })
          }
          await page.getByRole('button', { name: 'Copy availability' }).click()
          const copied = await page.evaluate(() => navigator.clipboard.readText())
          assert({
            given: 'one Monday opening removed by clicking its time range',
            should: 'copy exactly the visible bullets and no private events',
            actual: [
              copied,
              copied.includes('12:45'),
              events.some((event) => copied.includes(event.title)),
              await afternoon.getAttribute('aria-pressed'),
              await afternoon.getByText('Not proposed', { exact: true }).isVisible(),
              sends,
            ],
            expected: [await preview.inputValue(), false, false, 'false', true, 0],
          })
          // Hold booking's setup body open so going forward cancels it after the response headers arrive.
          await page.evaluate(() => {
            const browser: Window = window
            const fetch = browser.fetch
            browser.fetch = async (input, init) => {
              const signal = init?.signal
              if (input !== '/meetings/_api/setup' || !signal) return fetch(input, init)
              browser.fetch = fetch
              const response = await fetch(input, init)
              response.json = () =>
                new Promise((_, reject) => {
                  document.body.dataset.setupBody = 'pending'
                  signal.addEventListener('abort', () => reject(signal.reason), { once: true })
                })
              return response
            }
          })
          await page.goBack()
          await page.waitForFunction(() => document.title === 'sky · Reviewed title')
          assert({
            given: 'browser back to booking',
            should: 'retain manually reviewed details',
            actual: await page.getByLabel('Meeting title', { exact: true }).inputValue(),
            expected: 'Reviewed title',
          })
          await page.waitForFunction(() => document.body.dataset.setupBody === 'pending')
          await page.goForward()
          await page.waitForFunction(() => document.title === 'sky · Find a time')
          if ((await afternoon.getAttribute('aria-pressed')) === 'false') await afternoon.click()
          await page.getByRole('button', { name: 'Edit template' }).click()
          const editor = page.getByRole('dialog', { name: 'Edit availability template' })
          const lineInput = editor.getByRole('textbox', { name: 'Day line', exact: true })
          const saveTemplate = editor.getByRole('button', { name: 'Save template' })
          assert({
            given: 'a saved plain-text template from before day styles',
            should: 'open with the original wording and bullet format',
            actual: [
              await editor.getByLabel('Email template', { exact: true }).inputValue(),
              await lineInput.inputValue(),
              await page.title(),
            ],
            expected: [legacy, defaultDayLineStyle.dayLine, 'sky · Edit availability template'],
          })
          await lineInput.fill('{{times}}')
          assert({
            given: 'a day line with no day or date',
            should: 'point to the missing placeholder before saving',
            actual: [
              await saveTemplate.isDisabled(),
              await editor.getByText('Include {{day}}, {{weekday}}, or {{date}} to identify the day.').isVisible(),
            ],
            expected: [true, true],
          })
          const customLine = '  - {{weekday}} | {{times}}'
          const mondayLine = '  - Monday | 10–11:15 am / 12:45–3 pm'
          await lineInput.fill(customLine)
          await editor.getByLabel('Between openings', { exact: true }).fill(' / ')
          assert({
            given: 'a custom day line and separator',
            should: 'preview the actual selected openings with the exact spacing before save',
            actual: await editor.getByLabel('Day line preview', { exact: true }).textContent(),
            expected: mondayLine,
          })
          if (screenshots)
            await editor.screenshot({ path: path.join(screenshots, 'schedule-template.png'), animations: 'disabled' })
          await saveTemplate.click()
          await editor.waitFor({ state: 'hidden' })
          await page.getByRole('button', { name: 'Copy availability' }).click()
          const styled = await preview.inputValue()
          assert({
            given: 'changing just the day style while the model has polished the email',
            should: 'copy the exact custom lines with the polished introduction',
            actual: [
              styled.startsWith('Here are my openings'),
              styled.split('\n').includes(mondayLine),
              await page.evaluate(() => navigator.clipboard.readText()),
            ],
            expected: [true, true, styled],
          })
          const staleStyle = await page.request.post(origin + '/meetings/_api/availability/template', {
            data: {
              previous: { template: legacy, ...defaultDayLineStyle },
              format: { template: legacy, ...defaultDayLineStyle, timeSeparator: ', ' },
            },
          })
          assert({
            given: 'a stale editor with the same email wording',
            should: 'protect the newer day style',
            actual: staleStyle.status(),
            expected: 409,
          })
          await page.getByRole('button', { name: 'Edit template' }).click()
          const saved = 'I can meet at these times in {{timezone}}.\n\n{{days}}\n\nLet me know.'
          // An unusable model response falls back to the saved wording.
          fast.mockReturnValue({ model: modelReturning('Missing the required placeholders.') })
          await page.getByLabel('Email template', { exact: true }).fill(saved)
          await page.getByRole('button', { name: 'Save template' }).click()
          await previewStarts('I can meet')
          const stale = await page.request.post(origin + '/meetings/_api/availability/template', {
            data: { previous: defaultAvailabilityTemplate, template: defaultAvailabilityTemplate },
          })
          assert({
            given: 'a stale template editor',
            should: 'preserve the newer saved template',
            actual: stale.status(),
            expected: 409,
          })
          await page.setViewportSize({ width: 390, height: 844 })
          await reviewEvent.click()
          await page.getByRole('button', { name: 'Ignore this occurrence' }).click()
          await wholeAfternoon.waitFor()
          await picker.click()
          await work.click()
          await planning.waitFor({ state: 'detached' })
          await page.reload()
          await query.fill(request)
          await wholeAfternoon.waitFor()
          assert({
            given: 'a phone reload with one calendar off and an ignored reminder',
            should: 'remember both choices and allow the occurrence and the calendar to be restored',
            actual: [
              await picker.getAttribute('aria-label'),
              await mondayColumn.getByRole('group', { name: 'Ignored calendar event' }).count(),
              await planning.count(),
            ],
            expected: ['Calendars, 1 of 2 on', 1, 0],
          })
          await reviewEvent.click()
          await page.getByRole('button', { name: 'Count as busy' }).click()
          await afternoon.waitFor()
          await picker.click()
          await work.click()
          await page.keyboard.press('Escape')
          await planning.waitFor()
          await previewStarts('I can meet')
          assert({
            given: 'a reload after changing the wording',
            should: 'restore the saved day style and separator',
            actual: (await preview.inputValue()).split('\n').includes(mondayLine),
            expected: true,
          })
          await page.getByRole('button', { name: 'Edit template' }).click()
          await lineInput.fill('{{day}} {{times}}')
          await editor.getByRole('button', { name: 'Cancel' }).click()
          await editor.waitFor({ state: 'hidden' })
          assert({
            given: 'an unsaved day style on a phone',
            should: 'keep the saved lines when the editor is cancelled',
            actual: (await preview.inputValue()).split('\n').includes(mondayLine),
            expected: true,
          })
          await afternoon.click()
          if (screenshots)
            await page.screenshot({ path: path.join(screenshots, 'schedule-phone.png'), animations: 'disabled' })
          const layout = await page
            .locator('.sky-find-day')
            .evaluateAll((days) => days.map((day) => day.getBoundingClientRect().top))
          const horizontal = await grid.evaluate((viewport) => {
            const axis = viewport.querySelector('.sky-grid-axis')!
            const before = axis.getBoundingClientRect().left
            viewport.scrollLeft = viewport.scrollWidth
            const pinned = viewport.scrollLeft > 0 && Math.abs(axis.getBoundingClientRect().left - before) < 1
            viewport.scrollLeft = 0
            return pinned
          })
          assert({
            given: 'a direct load of Find a time on a phone',
            should: 'keep days on one horizontal grid with pinned hours and restore the saved template',
            actual: [
              layout.length,
              new Set(layout).size,
              horizontal,
              await page.evaluate(() => document.documentElement.scrollWidth),
              await page.title(),
            ],
            expected: [3, 1, true, 390, 'sky · Find a time'],
          })
          incomplete = true
          await page.evaluate(() => window.dispatchEvent(new Event('focus')))
          await page.getByText('Could not check Personal.', { exact: false }).first().waitFor()
          assert({
            given: 'a connected calendar that fails during refresh',
            should: 'keep the known events and the typed request while withholding unverified openings',
            actual: [
              await agenda.locator('button[aria-pressed]').count(),
              await planning.isVisible(),
              await page.getByRole('button', { name: 'Copy availability' }).isDisabled(),
              await query.inputValue(),
              sends,
            ],
            expected: [0, true, true, request, 0],
          })
          await picker.click()
          await personal.click()
          await wholeAfternoon.waitFor()
          assert({
            given: 'turning off the failed calendar while the working calendar stays on',
            should: 'release verified openings without waiting for the disabled calendar to recover',
            actual: [
              await planning.count(),
              await agenda.getByText('Could not check Personal.', { exact: false }).count(),
              await wholeAfternoon.getAttribute('aria-pressed'),
            ],
            expected: [1, 0, 'false'],
          })
          await personal.click()
          await page.keyboard.press('Escape')
          await page.getByText('Could not check Personal.', { exact: false }).first().waitFor()
          incomplete = false
          await page.getByRole('button', { name: 'Check again' }).first().click()
          await afternoon.waitFor()
          assert({
            given: 'a previously enabled calendar recovers after retrying the same filters',
            should: 'recover the proposed morning without re-adding the excluded afternoon',
            actual: [
              await mondayColumn.getByRole('button', { name: '10–11:15 am' }).getAttribute('aria-pressed'),
              await afternoon.getAttribute('aria-pressed'),
            ],
            expected: ['true', 'false'],
          })
          await page.getByLabel('Buffer between meetings in minutes').fill('30')
          await mondayColumn.getByRole('button', { name: '1–3 pm', exact: true }).waitFor()
          await page.getByRole('button', { name: 'Adjust search hours and time zone' }).click()
          await page.getByLabel('Until', { exact: true }).fill('16:00')
          await page.getByLabel('Until', { exact: true }).press('Escape')
          await mondayColumn.getByRole('button', { name: '1–2 pm', exact: true }).waitFor()
          await page.getByRole('combobox', { name: 'Display time zone' }).click()
          await page.getByRole('option', { name: 'Eastern', exact: true }).click()
          await mondayColumn.getByRole('button', { name: '4–5 pm', exact: true }).waitFor()
          assert({
            given: 'changing the buffer, search hours and output time zone',
            should: 'apply the edited limits to the calendar and to the copy-ready text',
            actual: [(await preview.inputValue()).includes('Eastern'), (await preview.inputValue()).includes('4–5 pm')],
            expected: [true, true],
          })
          parser.mockReturnValue({ model: modelReturning(JSON.stringify({ ...search, startMinutes: [0, 30] })) })
          await query.fill(request + ' Start on the hour or on the half hour.')
          await mondayColumn.getByRole('button', { name: '1–3 pm', exact: true }).waitFor()
          await page.getByRole('button', { name: 'Copy availability' }).click()
          const copy = await page.evaluate(() => navigator.clipboard.readText())
          assert({
            given: 'an hour-or-half-hour start request with a 15-minute buffer and Pacific output',
            should: 'align the grid and the copied day lines, and state the start rule once in the saved email format',
            actual: [
              await agenda.getByText('Starts on the hour or half hour', { exact: true }).isVisible(),
              await afternoon.count(),
              copy.includes('  - Monday | 10–11:15 am / 1–3 pm'),
              copy.split('I can start on the hour or half hour.').length - 1,
              copy === (await preview.inputValue()),
            ],
            expected: [true, 0, true, 1, true],
          })
          await page.getByRole('button', { name: 'Adjust search hours and time zone' }).click()
          const starts = page.getByLabel('Meeting starts (Pacific)')
          assert({
            given: 'an interpreted half-hour grid',
            should: 'let the user review the allowed start marks',
            actual: await starts.inputValue(),
            expected: '0,30',
          })
          await starts.selectOption('30')
          await mondayColumn.getByRole('button', { name: '1:30–3 pm', exact: true }).waitFor()
          await starts.selectOption('')
          await afternoon.waitFor()
          assert({
            given: 'switching meeting starts back to any minute',
            should: 'restore the buffered 12:45 opening and clear the previous start rule from the message',
            actual: [
              (await preview.inputValue()).includes('12:45–3 pm'),
              (await preview.inputValue()).includes('I can start'),
            ],
            expected: [true, false],
          })
          assert({
            given: 'the calendar available again',
            should: 'recover without browser errors',
            actual: errors,
            expected: [],
          })
        },
      )
    } finally {
      parser.mockRestore()
      fast.mockRestore()
    }
  },
)
