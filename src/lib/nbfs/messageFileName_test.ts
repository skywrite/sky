import { assert, test } from '#test'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import messageFileName from './messageFileName.ts'

test('messageFileName', async () => {
  const given = 'a message time, medium and slug'
  const should = 'name the file HH-MM_medium_slug.md under actions/messages'

  assert({
    given,
    should,
    expected: 'actions/messages/05-57_slack_Jane-to-atlas-gtm_Onramp-pricing-feasibility.md',
    actual: messageFileName(
      new PlainDateTime('2026-07-27 05:57'),
      'slack',
      'Jane-to-atlas-gtm_Onramp-pricing-feasibility',
    ),
  })

  assert({
    given: 'a midnight message time',
    should: 'zero-pad the hour rather than drop the prefix',
    expected: 'actions/messages/00-00_email_Jane-to-Joe_Contract-redline.md',
    actual: messageFileName(new PlainDateTime('2026-07-27 00:00'), 'email', 'Jane-to-Joe_Contract-redline'),
  })

  assert({
    given: 'a medium slug that already contains a hyphen',
    should: 'leave the medium untouched and only rewrite the time separator',
    expected: 'actions/messages/14-30_iMessage-Audio_Jane_Voice-note.md',
    actual: messageFileName(new PlainDateTime('2026-07-27 14:30'), 'iMessage-Audio', 'Jane_Voice-note'),
  })

  // Sorting the directory is the whole point of the prefix: a listing must
  // come back in the order the day happened, not in sender order.
  const day = [
    messageFileName(new PlainDateTime('2026-07-27 18:32'), 'slack', 'Zed-to-atlas-dev_Late-ping'),
    messageFileName(new PlainDateTime('2026-07-27 05:57'), 'slack', 'Jane-to-atlas-gtm_Early-ping'),
    messageFileName(new PlainDateTime('2026-07-27 09:26'), 'slack', 'Alice-to-Bob_Mid-morning'),
  ]

  assert({
    given: 'message names from one day sorted lexically',
    should: 'come back in chronological order',
    expected: ['05-57', '09-26', '18-32'],
    actual: [...day].sort().map((f) => f.slice('actions/messages/'.length, 'actions/messages/'.length + 5)),
  })
})
