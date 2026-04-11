import { assert, test } from '#test'
import * as config from '#config'
import CommandContext from '#commands/lib/core/CommandContext.ts'
import { BufferedOutput } from '#commands/lib/output/BufferedOutput.ts'
import { createLogin, createSecret } from '#lib/secrets/marshal.ts'
import SecretsGetTask from './get.ts'

function createContext(secrets: Record<string, import('#lib/secrets/types.ts').SecretEntry>) {
  const output = new BufferedOutput()
  const context = CommandContext.test(config, { secrets }).fork({ output })
  return { output, context }
}

test('secrets:get - retrieves a login entry', async () => {
  const { output, context } = createContext({
    'gmail/personal': createLogin({ user: 'jp@gmail.com', pass: 'abcd-efgh-ijkl-mnop' }),
  })

  const task = new SecretsGetTask()
  const result = await task.run({ args: { category: 'gmail', name: 'personal', reveal: false }, context } as any)

  const log = output.getLogs().join('\n')

  assert({
    given: 'a stored login entry',
    should: 'succeed',
    actual: result.ok,
    expected: true,
  })

  assert({
    given: 'a stored login entry',
    should: 'show the username',
    actual: log.includes('jp@gmail.com'),
    expected: true,
  })

  assert({
    given: 'a stored login entry without --reveal',
    should: 'mask the password',
    actual: log.includes('****mnop'),
    expected: true,
  })

  assert({
    given: 'a stored login entry',
    should: 'show the type',
    actual: log.includes('(login)'),
    expected: true,
  })
})

test('secrets:get - retrieves a secret entry', async () => {
  const { output, context } = createContext({
    'anthropic/main': createSecret('sk-ant-api03-verysecretkey'),
  })

  const task = new SecretsGetTask()
  const result = await task.run({ args: { category: 'anthropic', name: 'main', reveal: false }, context } as any)

  const log = output.getLogs().join('\n')

  assert({
    given: 'a stored secret entry',
    should: 'succeed',
    actual: result.ok,
    expected: true,
  })

  assert({
    given: 'a stored secret entry without --reveal',
    should: 'mask the value',
    actual: log.includes('****tkey'),
    expected: true,
  })

  assert({
    given: 'a stored secret entry',
    should: 'show the type',
    actual: log.includes('(secret)'),
    expected: true,
  })
})

test('secrets:get - reveals values with --reveal', async () => {
  const { output, context } = createContext({
    'gmail/personal': createLogin({ user: 'jp@gmail.com', pass: 'abcd-efgh-ijkl-mnop' }),
  })

  const task = new SecretsGetTask()
  const result = await task.run({ args: { category: 'gmail', name: 'personal', reveal: true }, context } as any)

  const log = output.getLogs().join('\n')

  assert({
    given: '--reveal flag',
    should: 'succeed',
    actual: result.ok,
    expected: true,
  })

  assert({
    given: '--reveal flag',
    should: 'show unmasked password',
    actual: log.includes('abcd-efgh-ijkl-mnop'),
    expected: true,
  })
})

test('secrets:get - fails for missing entry', async () => {
  const { context } = createContext({})

  const task = new SecretsGetTask()
  const result = await task.run({ args: { category: 'gmail', name: 'nonexistent', reveal: false }, context } as any)

  assert({
    given: 'a missing entry',
    should: 'fail',
    actual: result.failed,
    expected: true,
  })
})

test('secrets:get - shows notes when present', async () => {
  const { output, context } = createContext({
    'gmail/personal': createLogin({ user: 'u', pass: 'p' }, 'app password for IMAP'),
  })

  const task = new SecretsGetTask()
  await task.run({ args: { category: 'gmail', name: 'personal', reveal: false }, context } as any)

  const log = output.getLogs().join('\n')

  assert({
    given: 'an entry with notes',
    should: 'show notes in output',
    actual: log.includes('app password for IMAP'),
    expected: true,
  })
})
