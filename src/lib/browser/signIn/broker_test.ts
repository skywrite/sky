import { SensitiveValue } from '#lib/credentials/SensitiveValue.ts'
import type { CredentialSummary } from '#lib/credentials/types.ts'
import { assert, test } from '#test'
import { SignInBroker, type LoginSource, type SignInBrokerOptions, type SignInTarget } from './broker.ts'
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
          return { username: new SensitiveValue('jane@example.com'), password: new SensitiveValue(secret) }
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
