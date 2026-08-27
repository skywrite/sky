import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import ChannelWatch, { ChannelWatchRegistry } from './ChannelWatch.ts'

const WATCH_YAML = `\
source: Slack
channel: C0ATLAS0001
workspaceUrl: https://atlas.slack.com
label: releases
checkInterval: 30m
watchSince: 2026-02-15 09:00
lastChecked: 2026-02-15 10:00
lastSeenTs: "1750000000.000100"
status: active`

test('fromYaml/toYaml round-trips a watch', () => {
  const watch = ChannelWatch.fromYaml(WATCH_YAML)
  const again = ChannelWatch.fromYaml(watch.toYaml())

  assert({ given: 'a parsed watch', should: 'keep the channel', expected: 'C0ATLAS0001', actual: again.channel })
  assert({
    given: 'a parsed watch',
    should: 'keep the cursor',
    expected: '1750000000.000100',
    actual: again.lastSeenTs,
  })
  assert({ given: 'a parsed watch', should: 'keep the label', expected: 'releases', actual: again.label })
})

test('isDue() follows the check interval', () => {
  const watch = ChannelWatch.fromYaml(WATCH_YAML)

  assert({
    given: 'checked at 10:00 with a 30m interval',
    should: 'not be due at 10:20',
    expected: false,
    actual: watch.isDue(PlainDateTime.fromString('2026-02-15 10:20')),
  })
  assert({
    given: 'checked at 10:00 with a 30m interval',
    should: 'be due at 10:31',
    expected: true,
    actual: watch.isDue(PlainDateTime.fromString('2026-02-15 10:31')),
  })
  assert({
    given: 'a watch never checked',
    should: 'be due immediately',
    expected: true,
    actual: ChannelWatch.create({
      channel: 'C1',
      workspaceUrl: 'https://atlas.slack.com',
      label: 'x',
      lastSeenTs: '0.000000',
    }).isDue(PlainDateTime.fromString('2026-02-15 10:00')),
  })
  assert({
    given: 'a paused watch past its interval',
    should: 'never be due',
    expected: false,
    actual: ChannelWatch.fromYaml(WATCH_YAML.replace('status: active', 'status: paused')).isDue(
      PlainDateTime.fromString('2026-02-15 23:00'),
    ),
  })
})

test('updateCursor() advances lastSeenTs and lastChecked', () => {
  const watch = ChannelWatch.fromYaml(WATCH_YAML)
  const updated = watch.updateCursor('1750000099.000500', PlainDateTime.fromString('2026-02-15 11:00'))

  assert({ given: 'an updated cursor', should: 'advance', expected: '1750000099.000500', actual: updated.lastSeenTs })
  assert({
    given: 'an updated cursor',
    should: 'stamp lastChecked',
    expected: '2026-02-15 11:00',
    actual: `${updated.lastChecked?.date} ${updated.lastChecked?.time}`,
  })
  assert({
    given: 'immutability',
    should: 'not mutate the original',
    expected: '1750000000.000100',
    actual: watch.lastSeenTs,
  })
})

test('ChannelWatchRegistry loads a dir and finds by channel', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'channel-watch-test-'))
  await writeFile(path.join(dir, 'releases_C0ATLAS0001.yaml'), WATCH_YAML, 'utf-8')
  await writeFile(path.join(dir, 'bad.yaml'), 'lastChecked: not-a-date\n  broken', 'utf-8')

  const registry = await ChannelWatchRegistry.build(dir)

  assert({ given: 'one good and one bad yaml', should: 'load the good one', expected: 1, actual: registry.size })
  assert({ given: 'a malformed file', should: 'collect one error', expected: 1, actual: registry.errors.length })
  assert({
    given: 'a channel id',
    should: 'find its watch',
    expected: 'releases_C0ATLAS0001',
    actual: registry.findByChannel('C0ATLAS0001')?.fileName,
  })
  assert({
    given: 'an unknown channel id',
    should: 'find nothing',
    expected: undefined,
    actual: registry.findByChannel('C0NOPE')?.fileName,
  })
  assert({
    given: 'a due time past the interval',
    should: 'return the watch',
    expected: 1,
    actual: registry.getDue(PlainDateTime.fromString('2026-02-15 11:00')).length,
  })

  await rm(dir, { recursive: true })
})

test('ChannelWatchRegistry.build() on a missing dir returns empty', async () => {
  const registry = await ChannelWatchRegistry.build(path.join(tmpdir(), 'channel-watch-missing-xyz'))
  assert({ given: 'missing dir', should: 'be empty', expected: 0, actual: registry.size })
})
