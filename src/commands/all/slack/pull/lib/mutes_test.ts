import * as path from 'node:path'
import { makeTempDir } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import { readEffectiveSlackRules, slackMutedChannels } from './mutes.ts'
import { writeRules } from './rules.ts'

test('Slack channel mutes honor current notification settings and legacy preferences', () => {
  const notifications = {
    channels: { C0ATLAS0001: { muted: true }, C0ATLAS0002: { muted: false }, C0ATLAS0003: { desktop: 'nothing' } },
  }
  assert({
    given: 'legacy mutes and current settings, including a channel unmuted since the legacy list',
    should: 'honor explicit mutes and distinguish disabled notifications from muting',
    actual: [notifications, JSON.stringify(notifications)].map((value) =>
      slackMutedChannels({
        muted_channels: 'C0ATLAS0002, C0ATLAS0004, C0ATLAS0004',
        all_notifications_prefs: value,
      }),
    ),
    expected: [
      ['C0ATLAS0004', 'C0ATLAS0001'],
      ['C0ATLAS0004', 'C0ATLAS0001'],
    ],
  })
})

test('effective rules exclude channels muted in either Slack or Sky without changing local choices', async () => {
  const file = path.join(await makeTempDir({ prefix: 'sky-slack-mutes-' }), 'rules.yaml')
  await writeRules(file, { muted: ['C0ATLAS0001'] })
  const calls: string[] = []
  const rules = await readEffectiveSlackRules(file, 'https://atlas.slack.com', async (_workspace, method) => {
    calls.push(method)
    return { prefs: { all_notifications_prefs: JSON.stringify({ channels: { C0ATLAS0002: { muted: true } } }) } }
  })
  assert({
    given: 'one local mute and a different Slack mute',
    should: 'exclude both, and leave the local preferences independent of Slack',
    actual: { rules, local: await readEffectiveSlackRules(file, undefined), calls },
    expected: {
      rules: { muted: ['C0ATLAS0001', 'C0ATLAS0002'] },
      local: { muted: ['C0ATLAS0001'] },
      calls: ['users.prefs.get'],
    },
  })
})

test('unavailable or malformed Slack preferences cannot silently enable muted channels', async () => {
  const file = path.join(await makeTempDir({ prefix: 'sky-slack-mutes-' }), 'rules.yaml')
  for (const response of [undefined, { prefs: { all_notifications_prefs: '{invalid' } }]) {
    let failed = false
    try {
      await readEffectiveSlackRules(file, 'https://atlas.slack.com', async () => response)
    } catch {
      failed = true
    }
    assert({ given: 'unreadable Slack preferences', should: 'refuse the operation', actual: failed, expected: true })
  }
})
