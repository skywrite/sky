import { assert, test } from '#test'
import { looksLikeConversationId, pickChannelByName } from './resolveChannelName.ts'

const CHANNELS = [
  { id: 'C001', name: 'the-scoreboard' },
  { id: 'C002', name: 'scoreboard-alpha' },
  { id: 'C003', name: 'scoreboard-beta' },
  { id: 'C004', name: 'general' },
]

test('pickChannelByName - unique exact name resolves, with or without #', () => {
  assert({
    given: 'an exact channel name',
    should: 'resolve to its id',
    actual: [pickChannelByName(CHANNELS, 'general'), pickChannelByName(CHANNELS, '#General')],
    expected: [
      { kind: 'match', channel: { id: 'C004', name: 'general' } },
      { kind: 'match', channel: { id: 'C004', name: 'general' } },
    ],
  })
})

test('pickChannelByName - a partial name suggests, never guesses', () => {
  const pick = pickChannelByName(CHANNELS, 'scoreboard')
  assert({
    given: 'a name that several channels contain',
    should: 'return them as suggestions',
    actual: pick.kind === 'suggestions' ? pick.channels.map((c) => c.name) : pick.kind,
    expected: ['the-scoreboard', 'scoreboard-alpha', 'scoreboard-beta'],
  })
})

test('pickChannelByName - nothing close is none', () => {
  assert({
    given: 'a name matching no channel',
    should: 'answer none',
    actual: pickChannelByName(CHANNELS, 'quantum-kayak').kind,
    expected: 'none',
  })
})

test('looksLikeConversationId - ids pass, names do not', () => {
  assert({
    given: 'id and name shapes',
    should: 'tell them apart',
    actual: [
      looksLikeConversationId('C0946EJFPKL'),
      looksLikeConversationId('U0946EJFPKL'),
      looksLikeConversationId('scoreboard'),
      looksLikeConversationId('#general'),
    ],
    expected: [true, true, false, false],
  })
})
