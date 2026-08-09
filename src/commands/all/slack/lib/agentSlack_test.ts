import { assert, test } from '#test'
import { agentSlackEnv } from './agentSlack.ts'

const TIMEOUT_KEY = 'AGENT_SLACK_COMMAND_TIMEOUT_MS'
const RATE_KEY = 'AGENT_SLACK_RATE_LIMIT_MAX_WAIT_MS'

function withEnv(key: string, value: string | undefined, fn: () => void): void {
  const saved = process.env[key]
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
  try {
    fn()
  } finally {
    if (saved === undefined) delete process.env[key]
    else process.env[key] = saved
  }
}

test('agentSlackEnv supplies unattended-use defaults', () => {
  withEnv(TIMEOUT_KEY, undefined, () => {
    withEnv(RATE_KEY, undefined, () => {
      const env = agentSlackEnv()
      assert({
        given: 'no environment override',
        should: 'default the command timeout',
        actual: env[TIMEOUT_KEY],
        expected: '120000',
      })
      assert({
        given: 'no environment override',
        should: 'default the rate-limit wait',
        actual: env[RATE_KEY],
        expected: '30000',
      })
    })
  })
})

test('agentSlackEnv lets the environment win', () => {
  withEnv(TIMEOUT_KEY, '5000', () => {
    assert({
      given: 'an environment override',
      should: 'respect it over the default',
      actual: agentSlackEnv()[TIMEOUT_KEY],
      expected: '5000',
    })
  })
})
