import transformTypedParamsArgs from '#commands/lib/transformTypedParamsArgs/mod.ts'
import { assert, test } from '#test'
import EventNewTask from './new.ts'

const params = EventNewTask.description.params!
const MEMO = '/tmp/memo.m4a'

test('event:new — a voice memo comes in by --from-voice-memo, or by --from-audio, its alias', async () => {
  const dialog = await transformTypedParamsArgs(params, { _: ['event:new'], 'from-voice-memo': MEMO })
  const older = await transformTypedParamsArgs(params, { _: ['event:new'], 'from-audio': MEMO })
  const host = await transformTypedParamsArgs(params, { _: ['event:new'], fromVoiceMemo: MEMO })
  assert({
    given: "the dialog's spelling, the older one, and the key the import host sends",
    should: 'all name the same recording',
    actual: [dialog.fromAudio, older.fromAudio, host.fromAudio],
    expected: [MEMO, MEMO, MEMO],
  })

  let refused = false
  try {
    await transformTypedParamsArgs(params, {
      _: ['event:new'],
      'from-voice-memo': MEMO,
      'from-audio': '/tmp/other.m4a',
    })
  } catch {
    refused = true
  }
  assert({
    given: 'both spellings at once',
    should: 'refuse rather than pick one',
    actual: refused,
    expected: true,
  })
})
