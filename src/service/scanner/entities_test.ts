import { assert, test } from '#test'
import { INTERACTION_WEIGHTS } from '../store.ts'
import { getInteractionWeight } from './entities.ts'

const day = (rest: string) => `/notebook/time/2026/W35/08-29/${rest}`

test('getInteractionWeight: current HH-MM_Medium_ filenames classify by medium segment', () => {
  const cases: Array<[string, number]> = [
    [day('actions/meetings/09-45_Zoom_Jane-Doe-Sam-Rivera_Quarterly-Sync.md'), INTERACTION_WEIGHTS.meeting],
    [day('actions/meetings/08-30_In-Person_Sam-Rivera_Catch-Up.md'), INTERACTION_WEIGHTS.meeting],
    [day('actions/meetings/14-00_Google-Meet_Atlas-Team_Roadmap.md'), INTERACTION_WEIGHTS.meeting],
    [day('actions/messages/00-52_slack_Jane-to-atlas-team_Swap-Fees.md'), INTERACTION_WEIGHTS.slack],
    [day('actions/messages/10-11_imessage_Sam-Rivera_Lunch.md'), INTERACTION_WEIGHTS.slack],
    [day('actions/messages/11-20_whatsapp-audio_Jane-Doe_Voice-Note.md'), INTERACTION_WEIGHTS.slack],
    [day('actions/messages/12-05_signal_Sam-Rivera_Keys.md'), INTERACTION_WEIGHTS.slack],
    [day('actions/emails/10-15_email_Sam-Rivera_Renewal-Terms.md'), INTERACTION_WEIGHTS.email],
  ]
  for (const [filePath, expected] of cases) {
    assert({
      given: `current-convention path ${filePath.split('/').pop()}`,
      should: `weigh ${expected}`,
      expected,
      actual: getInteractionWeight(filePath),
    })
  }
})

test('getInteractionWeight: legacy conventions still classify', () => {
  const cases: Array<[string, number]> = [
    // Medium-first legacy naming
    [day('actions/meetings/zoom_Jane-Doe_Sync.md'), INTERACTION_WEIGHTS.meeting],
    [day('actions/meetings/In-Person_Sam-Rivera_Season-Opener.md'), INTERACTION_WEIGHTS.meeting],
    [day('actions/emails/email_Atlas-Renewal.md'), INTERACTION_WEIGHTS.email],
    [day('actions/messages/slack_Jane-Doe_Standup.md'), INTERACTION_WEIGHTS.slack],
    // Medium-last legacy naming
    [day('actions/meetings/Jane-Doe-Sam-Rivera_In-Person.md'), INTERACTION_WEIGHTS.meeting],
    [day('actions/meetings/Atlas-Team_Zoom.md'), INTERACTION_WEIGHTS.meeting],
  ]
  for (const [filePath, expected] of cases) {
    assert({
      given: `legacy path ${filePath.split('/').pop()}`,
      should: `weigh ${expected}`,
      expected,
      actual: getInteractionWeight(filePath),
    })
  }
})

test('getInteractionWeight: day files and events folder', () => {
  assert({
    given: 'a day.md file',
    should: 'weigh the day mention weight',
    expected: INTERACTION_WEIGHTS.day,
    actual: getInteractionWeight(day('day.md')),
  })
  assert({
    given: 'a file under an events folder with no medium segment',
    should: 'weigh as a meeting',
    expected: INTERACTION_WEIGHTS.meeting,
    actual: getInteractionWeight(day('actions/events/Team-Offsite.md')),
  })
})

test('getInteractionWeight: non-interaction files weigh 0', () => {
  const cases: string[] = [
    // Medium word inside a hyphenated title segment is not a medium
    day('actions/notes/11-00_notes_Jane-Doe_Zoom-Strategy-Discussion.md'),
    day('actions/notes/Virtual-Infrastructure.md'),
    // Deliberately unweighted media
    day('actions/messages/13-30_gdoc_Jane-Doe_Budget.md'),
    day('actions/messages/13-45_x_Atlas_Launch-Post.md'),
  ]
  for (const filePath of cases) {
    assert({
      given: `path ${filePath.split('/').pop()}`,
      should: 'weigh 0',
      expected: 0,
      actual: getInteractionWeight(filePath),
    })
  }
})
