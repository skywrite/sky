import mri from 'mri'
import { Flag } from '#commands/lib/params.ts'
import { assert, test } from '#test'
import transformTypedParamsArgs from './mod.ts'

test('stringArray accepts a single name or repeated flags without assuming comma syntax', async () => {
  const params = { names: Flag.stringArray('Names') }
  for (const [flags, expected] of [
    [['--names', 'One'], ['One']],
    [
      ['--names', 'One', '--names', 'Two'],
      ['One', 'Two'],
    ],
    [['--names', 'One, Two'], ['One, Two']],
  ]) {
    const args = await transformTypedParamsArgs(params, mri(['test:list', ...flags]))
    assert({
      given: flags.join(' '),
      should: 'collect names and leave delimiter handling to the parameter definition',
      actual: args.names,
      expected,
    })
  }
})

test('stringArray applies its async string parser once and validates existing arrays directly', async () => {
  const parsed: string[] = []
  const params = {
    names: Flag.stringArray('Names', {
      parse: async (raw) => {
        parsed.push(raw)
        return raw.split(',')
      },
      default: async () => ['Default'],
    }),
  }
  const raw = await transformTypedParamsArgs(params, { _: [], names: 'One,Two' })
  const existing = await transformTypedParamsArgs(params, { _: [], names: ['One, Two'] })
  const defaulted = await transformTypedParamsArgs(params, { _: [] })
  assert({
    given: 'a string, an existing list with a comma in one name, and an async default',
    should: 'parse only the string and preserve complete array values',
    actual: [raw.names, existing.names, defaulted.names, parsed],
    expected: [['One', 'Two'], ['One, Two'], ['Default'], ['One,Two']],
  })
})

test('stringArray optional and required parameters follow their declared presence rules', async () => {
  const optional = await transformTypedParamsArgs({ names: Flag.stringArray('Names') }, { _: [] })
  let missing = ''
  try {
    await transformTypedParamsArgs({ names: Flag.stringArray('Names', { required: true }) }, { _: [] })
  } catch (error) {
    missing = (error as Error).message
  }
  assert({
    given: 'missing optional and required list flags',
    should: 'leave the optional value absent and reject the missing required value',
    actual: [optional.names, missing],
    expected: [undefined, 'Required parameter "names" is missing'],
  })
})

test('list support keeps duplicate scalar flags invalid', async () => {
  const params = { name: Flag.string('Name') }
  let message = ''
  try {
    await transformTypedParamsArgs(params, mri(['test:scalar', '--name', 'One', '--name', 'Two']))
  } catch (error) {
    message = (error as Error).message
  }
  assert({
    given: 'a scalar flag supplied twice',
    should: 'retain the duplicate-flag error',
    actual: message,
    expected: 'Flag "--name" was specified multiple times',
  })
})
