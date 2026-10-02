import { SensitiveValue } from '#lib/credentials/SensitiveValue.ts'
import type { CredentialSummary } from '#lib/credentials/types.ts'
import { assert, test } from '#test'
import {
  SignInBroker,
  type LoginSource,
  type SignInBrokerOptions,
  type SignInTarget,
  type VerificationTarget,
} from './broker.ts'
import { approvalLabel } from './nativeApproval.ts'
import { LoginRedactor } from './redaction.ts'

function fixture() {
  const secret = 'synthetic-password-<Atlas>'
  const source: LoginSource = {
    id: 'example',
    account: 'example-account',
    label: 'Example account',
    excludedVaultIds: [],
  }
  let sources = [source]
  const item: CredentialSummary = {
    ref: { connectionId: source.id, containerId: 'vault', itemId: 'login' },
    title: 'Atlas',
    nativeCategory: 'Login',
    tags: [],
    websites: [{ url: 'https://atlas.example/sign-in', match: 'exact' }],
  }
  const calls: string[] = []
  let current = true
  const target: SignInTarget = {
    origin: 'https://atlas.example',
    current: async () => current,
    submit: async (values) => {
      calls.push('submit')
      if (!values.password.use((value) => value === secret)) throw new Error('Wrong value')
      return 'submitted'
    },
    dispose: async () => {
      calls.push('dispose')
    },
  }
  const options: SignInBrokerOptions = {
    sources: async () => sources,
    approval: {
      allowLookup: async () => {
        calls.push('lookup-approval')
        return true
      },
      choose: async () => {
        calls.push('use-approval')
        return 0
      },
    },
    connect: async () => {
      calls.push('connect')
      return {
        list: async () => {
          calls.push('list')
          return { items: [item], issues: [] }
        },
        readLogin: async () => {
          calls.push('read')
          return {
            username: new SensitiveValue('jane@example.com'),
            password: new SensitiveValue(secret),
            otp: { field: { id: 'otp' }, revision: '1' },
          }
        },
        readLoginOtp: async (ref, origin, binding) => {
          if (
            ref.itemId !== 'login' ||
            origin !== target.origin ||
            binding.field.id !== 'otp' ||
            binding.revision !== '1'
          )
            throw new Error('Verification escaped the approved login')
          calls.push('otp')
          return { code: new SensitiveValue('246810') }
        },
      }
    },
  }
  return {
    secret,
    calls,
    source,
    item,
    target,
    options,
    changePage: () => {
      current = false
    },
    disconnect: () => {
      sources = []
    },
  }
}

test('native approval precedes provider access; tool output contains only the outcome', async () => {
  const f = fixture()
  const result = await new SignInBroker(f.options).signIn(f.target)
  assert({
    given: 'a matching login and two native approvals',
    should: 'read only after selection and return no credential or account metadata',
    actual: [result, f.calls],
    expected: [
      { status: 'submitted' },
      ['lookup-approval', 'connect', 'list', 'use-approval', 'read', 'submit', 'dispose'],
    ],
  })
})

function verificationTarget(f: ReturnType<typeof fixture>): VerificationTarget {
  return {
    origin: f.target.origin,
    current: f.target.current,
    dispose: f.target.dispose,
    submit: async (otp, authorized) => {
      if (!(await authorized())) return 'needs_user'
      if (!otp.code.use((code) => code === '246810')) throw new Error('Unexpected code')
      f.calls.push('verified')
      return 'submitted'
    },
  }
}

test('verification uses only the approved login once and has no standalone credential access', async () => {
  const f = fixture()
  const broker = new SignInBroker(f.options)
  const before = await broker.verify(verificationTarget(f))
  await broker.signIn(f.target)
  const verified = await broker.verify(verificationTarget(f))
  const repeated = await broker.verify(verificationTarget(f))
  assert({
    given: 'verification before sign-in, after sign-in, and a repeated request',
    should: 'use only the one fresh code authorized by password selection, with safe status output',
    actual: [before, verified, repeated, f.calls.filter((call) => ['otp', 'verified', 'use-approval'].includes(call))],
    expected: [
      { status: 'needs_user' },
      { status: 'submitted' },
      { status: 'needs_user' },
      ['use-approval', 'otp', 'verified'],
    ],
  })
})

test('verification grants expire and are revoked by cancellation, changed targets, and changed source permissions', async () => {
  for (const change of [
    'expired',
    'aborted',
    'disconnected',
    'excluded',
    'origin',
    'document',
    'revoked',
    'during-read',
    'provider-error',
    'expired-code',
  ] as const) {
    const f = fixture()
    let now = 0
    f.options.now = () => now
    const abort = new AbortController()
    const connect = f.options.connect
    f.options.connect = async (source) => {
      const provider = await connect(source)
      return {
        ...provider,
        readLoginOtp: async (...args: Parameters<NonNullable<typeof provider.readLoginOtp>>) => {
          const code = await provider.readLoginOtp!(...args)
          if (change === 'during-read') f.disconnect()
          if (change === 'provider-error') throw new Error('246810')
          return change === 'expired-code' ? { ...code, expiresAt: '2000-01-01T00:00:00Z' } : code
        },
      }
    }
    const broker = new SignInBroker(f.options)
    await broker.signIn(f.target)
    const target = verificationTarget(f)
    if (change === 'expired') now = 120_001
    if (change === 'aborted') abort.abort()
    if (change === 'disconnected') f.disconnect()
    if (change === 'excluded') f.source.excludedVaultIds.push('vault')
    if (change === 'origin') target.origin = 'https://elsewhere.example'
    if (change === 'document') f.changePage()
    if (change === 'revoked') broker.revoke()
    const outcome = await broker.verify(target, abort.signal)
    await broker.verify(target)
    assert({
      given: change,
      should: 'never submit, leak an error value, or retry the code read',
      actual: [
        f.calls.includes('verified'),
        JSON.stringify(outcome).includes('246810'),
        f.calls.filter((c) => c === 'otp').length,
      ],
      expected: [false, false, ['during-read', 'provider-error', 'expired-code'].includes(change) ? 1 : 0],
    })
  }
})

test('verification accepts fresh computed codes and rejects malformed code values or expiry', async () => {
  for (const value of ['fresh', 'seed', 'expiry']) {
    const f = fixture()
    const connect = f.options.connect
    f.options.connect = async (source) => ({
      ...(await connect(source)),
      readLoginOtp: async () => ({
        code: new SensitiveValue(value === 'seed' ? 'otpauth://totp/example?secret=MOCK' : '246810'),
        expiresAt: value === 'expiry' ? 'invalid' : '2999-01-01T00:00:00Z',
      }),
    })
    const broker = new SignInBroker(f.options)
    await broker.signIn(f.target)
    const result = await broker.verify(verificationTarget(f))
    assert({
      given: value,
      should: 'submit only a usable computed code and keep all values out of the result',
      actual: [
        f.calls.includes('verified'),
        JSON.stringify(result).includes('246810'),
        JSON.stringify(result).includes('MOCK'),
      ],
      expected: [value === 'fresh', false, false],
    })
  }
})

test('cancellation, navigation and exclusion never turn approval into a reusable grant', async () => {
  const cases: { stage: string; change(f: ReturnType<typeof fixture>): void; read: boolean }[] = [
    {
      stage: 'lookup denied',
      change: (f) => {
        f.options.approval.allowLookup = async () => false
      },
      read: false,
    },
    {
      stage: 'selection denied',
      change: (f) => {
        f.options.approval.choose = async () => null
      },
      read: false,
    },
    {
      stage: 'forged selection',
      change: (f) => {
        f.options.approval.choose = async () => 100
      },
      read: false,
    },
    {
      stage: 'page navigated during approval',
      change: (f) => {
        f.options.approval.choose = async () => {
          f.changePage()
          return 0
        }
      },
      read: false,
    },
    {
      stage: 'account disconnected during approval',
      change: (f) => {
        f.options.approval.choose = async () => {
          f.disconnect()
          return 0
        }
      },
      read: false,
    },
    {
      stage: 'vault excluded during approval',
      change: (f) => {
        f.options.approval.choose = async () => {
          f.source.excludedVaultIds.push('vault')
          return 0
        }
      },
      read: false,
    },
    {
      stage: 'page navigated during read',
      change: (f) => {
        const connect = f.options.connect
        f.options.connect = async (source) => {
          const provider = await connect(source)
          return {
            ...provider,
            readLogin: async (...args) => {
              const login = await provider.readLogin(...args)
              f.changePage()
              return login
            },
          }
        }
      },
      read: true,
    },
  ]
  for (const entry of cases) {
    const f = fixture()
    entry.change(f)
    await new SignInBroker(f.options).signIn(f.target)
    assert({
      given: entry.stage,
      should: 'never submit and always release the concrete document',
      actual: [f.calls.includes('read'), f.calls.includes('submit'), f.calls.at(-1)],
      expected: [entry.read, false, 'dispose'],
    })
  }
})

test('site matching rejects subdomains, lookalikes, changed ports, non-HTTPS, and never-fill', async () => {
  for (const website of [
    'https://atlas.example.evil.test',
    'https://login.atlas.example',
    'https://atlas.example:444',
    'http://atlas.example',
    'https://user@atlas.example',
  ]) {
    const f = fixture()
    f.item.websites[0] = { url: website, match: 'subdomains' }
    const result = await new SignInBroker(f.options).signIn(f.target)
    assert({
      given: website,
      should: 'return a human handoff without reading a login',
      actual: [result.status, f.calls.includes('read')],
      expected: ['needs_user', false],
    })
  }
  const f = fixture()
  f.item.websites[0].match = 'never'
  await new SignInBroker(f.options).signIn(f.target)
  assert({
    given: 'never-fill metadata',
    should: 'not offer the login',
    actual: f.calls.includes('use-approval'),
    expected: false,
  })
})

test('aborts and provider exceptions cannot expose a secret or continue to fill', async () => {
  const f = fixture()
  f.options.connect = async () => {
    throw new Error(f.secret)
  }
  const failure = await new SignInBroker(f.options).signIn(f.target)
  const second = fixture()
  const controller = new AbortController()
  controller.abort()
  const stopped = await new SignInBroker(second.options).signIn(second.target, controller.signal)
  assert({
    given: 'a native failure and a pre-aborted request',
    should: 'return safe outcomes and never connect after revocation',
    actual: [failure, stopped, second.calls],
    expected: [{ status: 'unavailable' }, { status: 'needs_user' }, ['dispose']],
  })
})

test('credential reflection and native label control characters are removed', () => {
  const redactor = new LoginRedactor()
  redactor.remember({
    username: new SensitiveValue('jane@example.com'),
    password: new SensitiveValue('mock-<password>'),
  })
  assert({
    given: 'raw, URI, HTML and base64 echoes plus native prompt control characters',
    should: 'redact known values and render metadata as inert text',
    actual: [
      redactor.text('jane@example.com mock-<password> mock-%3Cpassword%3E mock-&lt;password&gt; bW9jay08cGFzc3dvcmQ+'),
      approvalLabel('Atlas\n\u001b[1m\u202eName'),
    ],
    expected: ['[redacted] [redacted] [redacted] [redacted] [redacted]', 'Atlas  [1m Name'],
  })
})
