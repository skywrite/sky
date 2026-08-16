import type { AgentSlackLaterItem } from '#commands/all/slack/cli/lib/agent-slack/types.ts'
import { assert, test } from '#test'
import {
  laterChannelLabel,
  laterConversationKind,
  laterItemLink,
  renderLaterRow,
  resolveStaleChannels,
} from './list.ts'

const item = (over: Partial<AgentSlackLaterItem>): AgentSlackLaterItem => ({
  channel_id: 'C0123ABCDEF',
  ts: '1750000000.000100',
  ...over,
})

test('laterChannelLabel picks the right conversation label', () => {
  assert({
    given: 'a named channel',
    should: 'prefix #',
    actual: laterChannelLabel(item({ channel_name: 'general' })),
    expected: '#general',
  })
  assert({
    given: 'a DM (D-prefixed id)',
    should: 'use the bare person name',
    actual: laterChannelLabel(item({ channel_id: 'D0123ABCDEF', channel_name: 'jane.doe' })),
    expected: 'jane.doe',
  })
  assert({
    given: 'a group DM slug',
    should: 'list the member handles',
    actual: laterChannelLabel(item({ channel_name: 'mpdm-alice--bob.smith--carol-1' })),
    expected: 'alice, bob.smith, carol',
  })
  assert({
    given: 'no channel name',
    should: 'fall back to the id',
    actual: laterChannelLabel(item({})),
    expected: 'C0123ABCDEF',
  })
})

test('laterItemLink builds the archives permalink', () => {
  assert({
    given: 'a workspace and an item',
    should: 'join with a p-prefixed dotless ts',
    actual: laterItemLink('https://atlas.slack.com', item({})),
    expected: 'https://atlas.slack.com/archives/C0123ABCDEF/p1750000000000100',
  })
})

test('laterConversationKind classifies the conversation', () => {
  assert({
    given: 'a named channel',
    should: 'be a channel',
    actual: laterConversationKind(item({ channel_name: 'general' })),
    expected: 'channel',
  })
  assert({
    given: 'a DM (D-prefixed id)',
    should: 'be a dm',
    actual: laterConversationKind(item({ channel_id: 'D0123ABCDEF', channel_name: 'jane.doe' })),
    expected: 'dm',
  })
  assert({
    given: 'a group DM slug',
    should: 'be a group',
    actual: laterConversationKind(item({ channel_name: 'mpdm-alice--bob.smith--carol-1' })),
    expected: 'group',
  })
  assert({
    given: 'no channel name',
    should: 'be unknown',
    actual: laterConversationKind(item({})),
    expected: 'unknown',
  })
})

/** Colors depend on TTY detection, so assertions compare the uncolored text. */
const stripAnsi = (lines: string[]): string[] => lines.map((line) => line.replaceAll(/\u001B\[\d+m/g, ''))

test('renderLaterRow lays out head, snippet, and link lines', () => {
  const row = {
    item: item({ channel_name: 'general', message: { content: 'hello  world\nsecond line' } }),
    timeLabel: '2026-01-05 09:30',
    link: 'https://atlas.slack.com/archives/C0123ABCDEF/p1750000000000100',
  }
  assert({
    given: 'a channel item with message content',
    should: 'render three aligned lines with a collapsed snippet',
    actual: stripAnsi(renderLaterRow(row, 0, { hyperlinks: false })),
    expected: [
      '   1. 2026-01-05 09:30  #general',
      '      hello world second line',
      '      https://atlas.slack.com/archives/C0123ABCDEF/p1750000000000100',
    ],
  })

  const linked = stripAnsi(renderLaterRow(row, 0, { hyperlinks: true }))
  assert({
    given: 'the same row with hyperlinks on',
    should: 'wrap the time in an OSC-8 link and drop the url line',
    expected: '2 lines, head linked: true',
    actual: `${linked.length} lines, head linked: ${linked[0].includes(
      ']8;;https://atlas.slack.com/archives/C0123ABCDEF/p17500000000001002026-01-05 09:30]8;;',
    )}`,
  })
})

test('renderLaterRow labels missing bodies and unresolved channels', () => {
  const link = 'https://atlas.slack.com/archives/C0123ABCDEF/p1750000000000100'
  assert({
    given: 'an item the export returned without a message',
    should: 'show a no-preview placeholder',
    actual: stripAnsi(
      renderLaterRow({ item: item({ channel_name: 'general' }), timeLabel: '09:30', link }, 1, { hyperlinks: false }),
    )[1],
    expected: '      (no preview — message not fetched)',
  })
  assert({
    given: 'a message with empty content',
    should: 'show a no-text placeholder',
    actual: stripAnsi(
      renderLaterRow(
        { item: item({ channel_name: 'general', message: { content: '' } }), timeLabel: '09:30', link },
        1,
        { hyperlinks: false },
      ),
    )[1],
    expected: '      (no text)',
  })
  assert({
    given: 'an item whose channel no longer resolves',
    should: 'mark the conversation unavailable instead of printing a bare id',
    actual: stripAnsi(renderLaterRow({ item: item({}), timeLabel: '09:30', link }, 9, { hyperlinks: false }))[0],
    expected: '  10. 09:30  ⚠ unavailable channel C0123ABCDEF',
  })
})

test('resolveStaleChannels names dead ids from timestamp twins', () => {
  const stale = resolveStaleChannels([
    item({ channel_id: 'C0DEAD00001', ts: '1750000001.000100' }),
    item({ channel_id: 'C0DEAD00001', ts: '1750000002.000100' }),
    item({ channel_id: 'C0LIVE00001', channel_name: 'atlas-updates', ts: '1750000001.000100' }),
    item({ channel_id: 'C0DEAD99999', ts: '1750000003.000100' }),
  ])
  assert({
    given: 'a dead id with a same-ts item under a live channel',
    should: 'take the twin channel name',
    actual: stale.get('C0DEAD00001')?.name,
    expected: 'atlas-updates',
  })
  assert({
    given: 'the twinned ts',
    should: 'be marked a duplicate save',
    actual: stale.get('C0DEAD00001')?.duplicateTs.has('1750000001.000100'),
    expected: true,
  })
  assert({
    given: 'a sibling ts with no twin',
    should: 'not be marked a duplicate',
    actual: stale.get('C0DEAD00001')?.duplicateTs.has('1750000002.000100'),
    expected: false,
  })
  assert({
    given: 'a dead id with no twins at all',
    should: 'stay unnamed',
    actual: stale.get('C0DEAD99999')?.name,
    expected: undefined,
  })
})

test('renderLaterRow labels stale rows with the twin-inferred channel', () => {
  const link = 'https://atlas.slack.com/archives/C0DEAD00001/p1750000001000100'
  const stale = resolveStaleChannels([
    item({ channel_id: 'C0DEAD00001', ts: '1750000001.000100' }),
    item({ channel_id: 'C0DEAD00001', ts: '1750000002.000100' }),
    item({ channel_id: 'C0LIVE00001', channel_name: 'atlas-updates', ts: '1750000001.000100' }),
  ])
  assert({
    given: 'a duplicate save under a dead id',
    should: 'name the channel and mark the duplicate',
    actual: stripAnsi(
      renderLaterRow(
        { item: item({ channel_id: 'C0DEAD00001', ts: '1750000001.000100' }), timeLabel: '09:30', link },
        0,
        { stale, hyperlinks: false },
      ),
    ).slice(0, 2),
    expected: [
      '   1. 09:30  #atlas-updates (duplicate save — stale channel id)',
      '      (same message as its live twin in this queue)',
    ],
  })
  assert({
    given: 'a stale-id save with no twin',
    should: 'name the channel and keep the no-preview placeholder',
    actual: stripAnsi(
      renderLaterRow(
        { item: item({ channel_id: 'C0DEAD00001', ts: '1750000002.000100' }), timeLabel: '09:30', link },
        1,
        { stale, hyperlinks: false },
      ),
    ).slice(0, 2),
    expected: ['   2. 09:30  #atlas-updates (stale channel id)', '      (no preview — message not fetched)'],
  })
})

test('renderLaterRow shows a reply badge for threads', () => {
  const row = {
    item: item({ channel_name: 'general', message: { content: 'kickoff', reply_count: 3 } }),
    timeLabel: '09:30',
    link: 'https://atlas.slack.com/archives/C0123ABCDEF/p1750000000000100',
  }
  assert({
    given: 'a message with replies',
    should: 'append a dim reply count to the head line',
    actual: stripAnsi(renderLaterRow(row, 0, { hyperlinks: false }))[0],
    expected: '   1. 09:30  #general  ↩ 3',
  })
})
