import type { Page } from 'playwright'
import { assert, test } from '#test'
import { withConfiguredBrowser } from './configuredBrowser.ts'
import type { ExistingBrowserConnection } from './existing/connection.ts'
import type { BrowserSession } from './persistentContext.ts'

const fallback = { profileDir: '/synthetic/Atlas/browser', headless: true }
const unexpected = async (): Promise<never> => {
  throw new Error('Unexpected fallback browser')
}

test('configured integration browser uses its owned tab and preserves the selected connection on cleanup', async () => {
  const events: string[] = []
  const page = {
    url: () => 'https://atlas.example/',
    addInitScript: async () => {
      events.push('prepare')
    },
    evaluate: async () => {},
  } as unknown as Page
  const protocol = async () => ({}) as never
  const deps: NonNullable<Parameters<typeof withConfiguredBrowser>[2]> = {
    settings: { read: async () => ({ browser: 'brave' }), token: async () => 'mock-extension-token' },
    connect: async (token, settings, options) => {
      assert({
        given: 'a selected Brave connection, even for a headless integration',
        should: 'connect through the extension in an owned background window',
        actual: [token, settings, options],
        expected: ['mock-extension-token', { browser: 'brave' }, { background: true }],
      })
      return {
        context: { pages: () => [{ url: () => 'https://personal.example/' }, page] },
        page,
        protocol,
        activateTaskTab: async () => {
          events.push('activate')
        },
        showTaskWindow: async () => {
          events.push('show')
        },
        close: async () => {
          events.push('disconnect')
        },
      } as unknown as ExistingBrowserConnection
    },
    persistent: unexpected,
  }
  const result = await withConfiguredBrowser(
    fallback,
    async (session, target) => {
      events.push('run')
      assert({
        given: 'the connected context also contains personal tabs',
        should: 'bind reads and credential entry to the owned page and its extension protocol',
        actual: [session.currentUrl(), target.page === page, target.protocol === protocol],
        expected: ['https://atlas.example/', true, true],
      })
      return 'finished'
    },
    deps,
  )
  assert({
    given: 'a completed unattended command',
    should: 'disconnect without presenting a foreground window or opening a separate profile',
    actual: [result, events],
    expected: ['finished', ['prepare', 'activate', 'run', 'disconnect']],
  })
  events.length = 0
  const failure = new Error('Command failed')
  let caught: unknown
  try {
    await withConfiguredBrowser(
      { ...fallback, headless: false },
      async () => {
        throw failure
      },
      deps,
    )
  } catch (error) {
    caught = error
  }
  assert({
    given: 'an interactive command that fails',
    should: 'show its owned window and still disconnect',
    actual: [caught === failure, events],
    expected: [true, ['activate', 'show', 'disconnect']],
  })
})

test('an unavailable selected connection never falls back to another browser identity', async () => {
  for (const step of ['settings', 'token', 'connect']) {
    const failure = new Error(`Synthetic ${step} failure`)
    let ran = false
    let caught: unknown
    try {
      await withConfiguredBrowser(
        fallback,
        async () => {
          ran = true
        },
        {
          settings: {
            read: async () => {
              if (step === 'settings') throw failure
              return { browser: 'brave' }
            },
            token: async () => {
              if (step === 'token') throw failure
              return 'mock-extension-token'
            },
          },
          connect: async () => {
            throw failure
          },
          persistent: unexpected,
        },
      )
    } catch (error) {
      caught = error
    }
    assert({
      given: `the selected connection fails at ${step}`,
      should: 'preserve the connection error without running the command or switching profiles',
      actual: [caught === failure, ran],
      expected: [true, false],
    })
  }
})

test('an integration without a selected connection retains its existing persistent profile', async () => {
  const page = { addInitScript: async () => {}, evaluate: async () => {} } as unknown as Page
  const session = {} as BrowserSession
  let retained: unknown
  await withConfiguredBrowser(
    fallback,
    async (actualSession, target) => {
      assert({
        given: 'an existing dedicated session with no browser connection selected',
        should: 'pass through the session and its owned page',
        actual: [actualSession === session, target.page === page, target.protocol],
        expected: [true, true, undefined],
      })
    },
    {
      settings: { read: async () => undefined, token: unexpected },
      connect: unexpected,
      persistent: async (options, run) => {
        retained = options
        return run(session, { pages: () => [page] } as never)
      },
    },
  )
  assert({
    given: 'the fallback launch',
    should: 'keep its stable profile options',
    actual: retained,
    expected: fallback,
  })
})
