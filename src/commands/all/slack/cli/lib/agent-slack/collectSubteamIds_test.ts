import { assert, test } from '#test'
import collectSubteamIds from './collectSubteamIds.ts'

test('collectSubteamIds: extracts bare and labeled usergroup mentions', () => {
  assert({
    given: 'messages with a bare and a labeled subteam mention',
    should: 'return both IDs',
    actual: collectSubteamIds([
      { content: 'cc <!subteam^S0123TEAMAB> please' },
      { content: 'and <!subteam^S0456TEAMCD|@atlas-core> too' },
    ]).sort(),
    expected: ['S0123TEAMAB', 'S0456TEAMCD'],
  })
})

test('collectSubteamIds: deduplicates across messages', () => {
  assert({
    given: 'the same subteam mentioned twice',
    should: 'return the ID once',
    actual: collectSubteamIds([{ content: '<!subteam^S0123TEAMAB>' }, { content: '<!subteam^S0123TEAMAB>' }]),
    expected: ['S0123TEAMAB'],
  })
})

test('collectSubteamIds: ignores other mention forms and empty content', () => {
  assert({
    given: 'user mentions, channel mentions, special mentions, and a bodyless message',
    should: 'return nothing',
    actual: collectSubteamIds([{ content: '@U0123ABCDEF <#C0123ATLASX> @here' }, {}]),
    expected: [],
  })
})
