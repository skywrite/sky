import Follow from '#shared/models/Follow/mod.ts'
import { assert, test } from '#test'
import { anchorTs } from './merge.ts'

test('anchorTs() reads thread_ts first, then the link p-ts', () => {
  assert({
    given: 'an anchor with thread_ts',
    should: 'use it',
    expected: '1750000001.000001',
    actual: anchorTs({ channel: 'C1', thread_ts: '1750000001.000001', link: 'https://atlas.slack.com/archives/C1/p9' }),
  })
  assert({
    given: 'an anchor with only a link',
    should: 'read the p-ts',
    expected: '1750000002.000002',
    actual: anchorTs({ channel: 'C1', link: 'https://atlas.slack.com/archives/C1/p1750000002000002' }),
  })
  assert({
    given: 'an anchor with neither',
    should: 'return empty',
    expected: '',
    actual: anchorTs({ channel: 'C1' }),
  })
})

test('Follow round-trips merged anchors through YAML', () => {
  const follow = Follow.create({
    source: 'Slack',
    ref: {
      channel: 'C0ATLAS0009',
      thread_ts: '1750000001.000001',
      link: 'https://atlas.slack.com/archives/C0ATLAS0009/p1750000001000001',
    },
    merged: [
      {
        channel: 'C0ATLAS0009',
        thread_ts: '1750000002.000002',
        link: 'https://atlas.slack.com/archives/C0ATLAS0009/p1750000002000002',
      },
    ],
    summary: 'Merged widget conversation',
    messages: [{ date: '2026-02-15', path: '2026-02-15/actions/messages/x.md' }],
  })
  const again = Follow.fromYaml(follow.toYaml())

  assert({ given: 'a merged follow', should: 'keep its anchor count', expected: 1, actual: again.merged.length })
  assert({
    given: 'a merged follow',
    should: 'keep the merged thread_ts',
    expected: '1750000002.000002',
    actual: again.merged[0]?.thread_ts,
  })
  assert({
    given: 'an unmerged follow round-tripped',
    should: 'still have no merged anchors',
    expected: 0,
    actual: Follow.fromYaml(again.withMerged([]).toYaml()).merged.length,
  })
})

test('withRef/withMerged/withMessages produce updated copies', () => {
  const follow = Follow.create({
    source: 'Slack',
    ref: { channel: 'C1', thread_ts: '1.000001' },
    summary: 'x',
  })
  const swapped = follow.withRef({ channel: 'C1', thread_ts: '2.000002' })
  assert({ given: 'withRef', should: 'swap the ref', expected: '2.000002', actual: swapped.ref.thread_ts })
  assert({ given: 'withRef', should: 'not mutate the original', expected: '1.000001', actual: follow.ref.thread_ts })
  assert({
    given: 'withMessages',
    should: 'replace the list',
    expected: 2,
    actual: follow.withMessages([
      { date: '2026-02-15', path: 'a.md' },
      { date: '2026-02-16', path: 'b.md' },
    ]).messages.length,
  })
})
