import * as path from 'node:path'
import { createGoogleCalendarHost } from '#lib/calendarScheduler/google.ts'
import { meetingPeople } from '#lib/calendarScheduler/people.ts'
import type { CalendarSchedulerHost } from '#lib/calendarScheduler/types.ts'
import { KeychainSecretsProvider } from '#lib/secrets/KeychainSecretsProvider.ts'
import { createWritingVoice } from '#lib/writingVoice/runtime.ts'
import type * as ConfigModule from '#shared/config.ts'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import type { Store } from '../../store.ts'

/** The web service supplies its live contact index and interaction scores. */
export function createMeetingsHost(
  config: typeof ConfigModule,
  store: () => MarkdownStore | null,
  scores: Pick<Store, 'getPeopleWithScores'>,
): CalendarSchedulerHost {
  const calendar = createGoogleCalendarHost({
    // Keep the existing job directory so earlier invitation receipts survive the extraction.
    dir: path.join(config.DIR_USER_DATA, 'meetings'),
    secrets: new KeychainSecretsProvider(),
    people: async (query) => meetingPeople(store(), query, scores.getPeopleWithScores()),
  })
  const voice = createWritingVoice(config)
  return { ...calendar, writingRules: async () => (await voice.store.rules()).text }
}
