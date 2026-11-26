import { assert, test } from '#test'
import { readTailnet, tailnetIdentity, type TailscaleStatus } from './identity.ts'

const RUNNING: TailscaleStatus = {
  BackendState: 'Running',
  Self: { DNSName: 'Atlas-Mac.tail-example.ts.net.', UserID: 7 },
  User: { '7': { LoginName: 'jane@example.com' }, '8': { LoginName: 'joe@example.com' } },
}

test('the tailnet is read from Tailscale’s status only while it runs and names this Mac and its owner', () => {
  assert({
    given: 'a running Tailscale',
    should: 'give the Mac’s name without the trailing dot, in lower case, and the owner’s login',
    actual: readTailnet(RUNNING),
    expected: { host: 'atlas-mac.tail-example.ts.net', login: 'jane@example.com' },
  })
  assert({
    given: 'Tailscale signed out, a Mac with no name, and an owner Tailscale does not list',
    should: 'read as no tailnet each time',
    actual: [
      readTailnet({ ...RUNNING, BackendState: 'NeedsLogin' }),
      readTailnet({ ...RUNNING, Self: { UserID: 7 } }),
      readTailnet({ ...RUNNING, Self: { DNSName: 'atlas-mac.tail-example.ts.net.', UserID: 9 } }),
    ],
    expected: [null, null, null],
  })
})

test('Tailscale is asked once a minute, through the app’s command when none is on the PATH', async () => {
  let clock = 0
  const asked: string[] = []
  const lookup = tailnetIdentity(
    async (command) => {
      asked.push(command)
      return command === 'tailscale'
        ? { success: false, code: 1, stdout: '', stderr: 'not found' }
        : { success: true, code: 0, stdout: JSON.stringify(RUNNING), stderr: '' }
    },
    () => clock,
  )
  const first = await lookup()
  clock = 59_000
  await lookup()
  clock = 61_000
  await lookup()
  assert({
    given: 'no command on the PATH, then three lookups across a minute',
    should: 'find the app’s command, and ask again only once the reading is a minute old',
    actual: { first, asked },
    expected: {
      first: { host: 'atlas-mac.tail-example.ts.net', login: 'jane@example.com' },
      asked: [
        'tailscale',
        '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
        'tailscale',
        '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
      ],
    },
  })

  const missing = tailnetIdentity(async () => ({ success: false, code: 1, stdout: '', stderr: 'not found' }))
  assert({
    given: 'no Tailscale on this Mac',
    should: 'read as no tailnet',
    actual: await missing(),
    expected: null,
  })
})
