import { assert, test } from '#test'
import { restoreKeychainSession } from './keychainRecovery.ts'

for (const scenario of [
  { name: 'a healthy unlocked keychain', unlocked: true, checks: [0], expected: 0, calls: ['status', 'check'] },
  {
    name: 'a locked keychain',
    unlocked: false,
    checks: [0],
    expected: 0,
    calls: ['status', 'unlock', 'check'],
  },
  {
    name: 'an unlocked keychain with stale authentication',
    unlocked: true,
    checks: [-25293, 0],
    expected: 0,
    calls: ['status', 'check', 'lock', 'unlock', 'check'],
  },
  {
    name: 'an unrelated settings error',
    unlocked: true,
    checks: [-25337],
    expected: -25337,
    calls: ['status', 'check'],
  },
  {
    name: 'a failed status check',
    unlocked: true,
    status: -25294,
    checks: [],
    expected: -25294,
    calls: ['status'],
  },
  {
    name: 'a failed lock',
    unlocked: true,
    checks: [-25293],
    lock: -25308,
    expected: -25308,
    calls: ['status', 'check', 'lock'],
  },
  {
    name: 'a cancelled unlock prompt',
    unlocked: true,
    checks: [-25293],
    unlock: -128,
    expected: -128,
    calls: ['status', 'check', 'lock', 'unlock'],
  },
  {
    name: 'an unlock that claims success but leaves authentication broken',
    unlocked: false,
    checks: [-25293],
    expected: -25293,
    calls: ['status', 'unlock', 'check'],
  },
]) {
  test(`Keychain recovery handles ${scenario.name}`, () => {
    const calls: string[] = []
    const checks = [...scenario.checks]
    const result = restoreKeychainSession({
      status: () => {
        calls.push('status')
        return { status: scenario.status ?? 0, unlocked: scenario.unlocked }
      },
      check: () => {
        calls.push('check')
        return checks.shift()!
      },
      lock: () => {
        calls.push('lock')
        return scenario.lock ?? 0
      },
      unlock: () => {
        calls.push('unlock')
        return scenario.unlock ?? 0
      },
    })
    assert({
      given: scenario.name,
      should: 'only change the session when necessary, verify recovery, and never retry a refused prompt',
      actual: { result, calls },
      expected: { result: scenario.expected, calls: scenario.calls },
    })
  })
}
