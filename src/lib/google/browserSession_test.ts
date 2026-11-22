import type { BrowserContext, Page } from 'playwright'
import type { ExistingBrowserConnection } from '#lib/browser/existing/connection.ts'
import type { ExistingBrowserSettings } from '#lib/browser/existing/settings.ts'
import {
  createGoogleBrowserController,
  GoogleBrowserError,
  isSignedOutUrl,
  openGooglePage,
} from '#lib/google/browserSession.ts'
import { assert, test } from '#test'

function mockPage(url = 'https://docs.google.com/document/d/doc-1/edit', accountLabel?: string) {
  let closed = false
  let currentUrl = url
  const closeListeners: Array<() => void> = []
  const page = {
    url: () => currentUrl,
    isClosed: () => closed,
    goto: async (next: string) => {
      currentUrl = next
    },
    waitForTimeout: async () => {},
    locator: () => ({
      first: () => ({
        isVisible: async () => accountLabel !== undefined,
        getAttribute: async () => accountLabel ?? null,
      }),
    }),
    once: (event: string, fn: () => void) => {
      if (event === 'close') closeListeners.push(fn)
    },
    on: (event: string, fn: () => void) => {
      if (event === 'close') closeListeners.push(fn)
    },
    off: () => {},
    triggerClose: () => {
      closed = true
      for (const fn of closeListeners) fn()
    },
  }
  return page as unknown as Page & { triggerClose: () => void }
}

function mockContext(pages: Page[]) {
  const closeListeners: Array<() => void> = []
  const context = {
    pages: () => pages,
    once: (event: string, fn: () => void) => {
      if (event === 'close') closeListeners.push(fn)
    },
    on: (event: string, fn: () => void) => {
      if (event === 'close') closeListeners.push(fn)
    },
    off: () => {},
    close: async () => {
      for (const fn of closeListeners) fn()
    },
  }
  return context as unknown as BrowserContext
}

test('connected Brave reuses one owned background tab across a warm mission and disconnects on release', async () => {
  const events: string[] = []
  const personalPage = mockPage('https://personal.example/')
  const ownedPage = mockPage('https://docs.google.com/document/d/doc-1/edit')
  const context = mockContext([personalPage, ownedPage])
  const controller = createGoogleBrowserController({
    settings: {
      read: async () => ({ browser: 'brave', profileDirName: 'Default' }),
      token: async () => 'mock-brave-extension-token',
    },
    connect: async (token, settings, options) => {
      events.push(`connect:${token}:${settings.profileDirName}:${String(options?.background)}`)
      return {
        context,
        page: ownedPage,
        protocol: async () => ({}) as never,
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
    launchPersistent: async () => {
      throw new Error('Unexpected persistent fallback when Brave is connected')
    },
    preparePage: async (page) => {
      events.push(page === ownedPage ? 'prepare:owned' : 'prepare:other')
    },
    warmIdleMs: 60_000,
  })

  const releaseMission = controller.retainGoogleBrowser()
  const first = await controller.withGoogleBrowser({ headless: true }, async (session) => {
    events.push(`flow1:${String(session.existing)}:${String(session.page === ownedPage)}`)
    return 'c1'
  })
  const second = await controller.withGoogleBrowser({ headless: true }, async (session) => {
    events.push(`flow2:${String(session.existing)}:${String(session.page === ownedPage)}`)
    return 'c2'
  })
  await releaseMission()

  assert({
    given: 'two consecutive headless comment flows under one retained mission with Brave connected',
    should: 'connect once, reuse the owned background tab without showing the window, and disconnect on release',
    actual: { results: [first, second], events },
    expected: {
      results: ['c1', 'c2'],
      events: [
        'connect:mock-brave-extension-token:Default:true',
        'prepare:owned',
        'activate',
        'flow1:true:true',
        'prepare:owned',
        'activate',
        'flow2:true:true',
        'disconnect',
      ],
    },
  })
})

test('interactive sign-in on connected Brave shows the owned window and disconnects afterward', async () => {
  const events: string[] = []
  const ownedPage = mockPage('about:blank')
  const controller = createGoogleBrowserController({
    settings: {
      read: async () => ({ browser: 'brave' }),
      token: async () => 'mock-brave-extension-token',
    },
    connect: async () =>
      ({
        context: mockContext([ownedPage]),
        page: ownedPage,
        protocol: async () => ({}) as never,
        activateTaskTab: async () => {
          events.push('activate')
        },
        showTaskWindow: async () => {
          events.push('show')
        },
        close: async () => {
          events.push('disconnect')
        },
      }) as unknown as ExistingBrowserConnection,
    launchPersistent: async () => {
      throw new Error('Unexpected persistent fallback')
    },
    preparePage: async () => {
      events.push('prepare')
    },
  })

  await controller.withGoogleBrowser({ headless: false, closeAfter: true }, async () => {
    events.push('signin')
  })

  assert({
    given: 'a headed sign-in flow with connected Brave',
    should:
      'activate and foreground the owned task window without suppressing password-manager offers, then disconnect',
    actual: events,
    expected: ['activate', 'show', 'signin', 'disconnect'],
  })
})

test('an unavailable selected Brave connection never falls back to Sky’s persistent profile', async () => {
  for (const step of ['settings', 'token', 'connect'] as const) {
    const failure = new Error(`Synthetic ${step} failure`)
    let launchedPersistent = false
    const controller = createGoogleBrowserController({
      settings: {
        read: async (): Promise<ExistingBrowserSettings | undefined> => {
          if (step === 'settings') throw failure
          return { browser: 'brave' }
        },
        token: async () => {
          if (step === 'token') throw failure
          return 'mock-token'
        },
      },
      connect: async () => {
        throw failure
      },
      launchPersistent: async () => {
        launchedPersistent = true
        throw new Error('Should not launch persistent profile')
      },
      preparePage: async () => {},
    })

    let caught: unknown
    try {
      await controller.withGoogleBrowser({ headless: true }, async () => 'ok')
    } catch (err) {
      caught = err
    }

    assert({
      given: `connected Brave fails at ${step}`,
      should: 'propagate the connection failure without switching browser profiles',
      actual: [caught === failure, launchedPersistent],
      expected: [true, false],
    })
  }
})

test('persistent profile fallback checkpoints cookies, stays warm across headless flows, and relaunches when headed', async () => {
  const events: string[] = []
  const controller = createGoogleBrowserController({
    settings: { read: async () => undefined, token: async () => '' },
    connect: async () => {
      throw new Error('Unexpected existing-browser connect')
    },
    launchPersistent: async ({ headless }) => {
      const mode = headless ? 'headless' : 'headed'
      events.push(`launch:${mode}`)
      const page = mockPage()
      return {
        context: mockContext([page]),
        page,
        saveCookies: async () => {
          events.push(`saveCookies:${mode}`)
        },
        close: async () => {
          events.push(`close:${mode}`)
        },
      }
    },
    preparePage: async () => {
      events.push('prepare')
    },
    warmIdleMs: 60_000,
  })

  const releaseMission = controller.retainGoogleBrowser()
  await controller.withGoogleBrowser({ headless: true }, async (session) => {
    events.push(`flow1:existing=${String(session.existing)}`)
  })
  await controller.withGoogleBrowser({ headless: true }, async () => {
    events.push('flow2')
  })
  await controller.withGoogleBrowser({ headless: false, closeAfter: true }, async () => {
    events.push('signin')
  })
  await releaseMission()

  assert({
    given: 'two headless flows followed by a headed sign-in when no Brave connection is configured',
    should: 'share one headless launch, checkpoint cookies after each flow, and relaunch headed for sign-in',
    actual: events,
    expected: [
      'launch:headless',
      'prepare',
      'flow1:existing=false',
      'saveCookies:headless',
      'prepare',
      'flow2',
      'saveCookies:headless',
      'close:headless',
      'launch:headed',
      'signin',
      'saveCookies:headed',
      'close:headed',
    ],
  })
})

test('a wedged flow hits its deadline and closes the session so the next queued call recovers cleanly', async () => {
  let launches = 0
  const controller = createGoogleBrowserController({
    settings: { read: async () => undefined, token: async () => '' },
    connect: async () => {
      throw new Error('Unexpected connect')
    },
    launchPersistent: async () => {
      launches++
      const page = mockPage()
      return {
        context: mockContext([page]),
        page,
        saveCookies: async () => {},
        close: async () => {
          page.triggerClose()
        },
      }
    },
    preparePage: async () => {},
    flowDeadlineMs: 25,
  })

  const first = controller
    .withGoogleBrowser({ headless: true }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 80))
      return 'late'
    })
    .then(
      () => 'resolved',
      (err) => (err instanceof GoogleBrowserError ? 'timed-out' : String(err)),
    )

  const second = controller.withGoogleBrowser({ headless: true, closeAfter: true }, async () => 'recovered')

  assert({
    given: 'a flow exceeding its deadline with another call queued behind it',
    should: 'fail the wedged flow as GoogleBrowserError and start a fresh browser for the queued call',
    actual: [await first, await second, launches],
    expected: ['timed-out', 'recovered', 2],
  })
})

test('openGooglePage rejects signed-out redirects and wrong Google accounts', async () => {
  const signedOutPage = mockPage('https://docs.google.com/document/d/doc-1/edit')
  signedOutPage.goto = async () => {
    ;(signedOutPage as unknown as { url: () => string }).url = () => 'https://accounts.google.com/v3/signin/identifier'
    return null
  }
  let signedOutMessage = ''
  try {
    await openGooglePage({ page: signedOutPage, existing: true }, 'https://docs.google.com/document/d/doc-1/edit', {
      account: 'jane@example.com',
    })
  } catch (err) {
    signedOutMessage = err instanceof Error ? err.message : String(err)
  }

  const wrongAccountPage = mockPage(
    'https://docs.google.com/document/d/doc-1/edit',
    'Google Account: Other Person (other@example.com)',
  )
  let wrongAccountMessage = ''
  try {
    await openGooglePage(wrongAccountPage, 'https://docs.google.com/document/d/doc-1/edit', {
      account: 'jane@example.com',
    })
  } catch (err) {
    wrongAccountMessage = err instanceof Error ? err.message : String(err)
  }

  const matchingAccountPage = mockPage(
    'https://docs.google.com/document/d/doc-1/edit',
    'Google Account: Jane Doe (jane@example.com)',
  )
  const opened = await openGooglePage(matchingAccountPage, 'https://docs.google.com/document/d/doc-1/edit', {
    account: 'jane@example.com',
  })

  assert({
    given: 'signed-out URLs, a mismatched account header, and a matching account header',
    should: 'flag signed-out and wrong-account pages with recovery guidance while allowing matching accounts',
    actual: {
      detectsLoginHost: isSignedOutUrl('https://accounts.google.com/ServiceLogin'),
      signedOutMentionsBraveAndAccount:
        signedOutMessage.includes('connected Brave') && signedOutMessage.includes('--account jane@example.com'),
      wrongAccountMentionsExpected:
        wrongAccountMessage.includes('different account than jane@example.com') &&
        wrongAccountMessage.includes('sky google:browser --account jane@example.com'),
      matchingReturnedPage: opened === matchingAccountPage,
    },
    expected: {
      detectsLoginHost: true,
      signedOutMentionsBraveAndAccount: true,
      wrongAccountMentionsExpected: true,
      matchingReturnedPage: true,
    },
  })
})

test('openGooglePage recovers when connected Brave re-announces the tab across a renderer swap and reuses a loaded Doc', async () => {
  const initialBlank = mockPage('about:blank')
  const reattachedDoc = mockPage(
    'https://docs.google.com/document/d/doc-1/edit?tab=t.0',
    'Google Account: Jane Doe (jane@example.com)',
  )
  let gotoCount = 0
  reattachedDoc.goto = async () => {
    gotoCount++
    return null
  }
  initialBlank.waitForTimeout = async () => {
    initialBlank.triggerClose()
    throw new Error('waitForTimeout: Target page, context or browser has been closed')
  }
  const context = mockContext([initialBlank, reattachedDoc])

  const recovered = await openGooglePage(
    { page: initialBlank, existing: true, context },
    'https://docs.google.com/document/d/doc-1/edit?authuser=jane%40example.com',
    { account: 'jane@example.com' },
  )

  const reused = await openGooglePage(
    { page: recovered, existing: true, context },
    'https://docs.google.com/document/d/doc-1/edit?authuser=jane%40example.com',
    { account: 'jane@example.com', reuseLoadedDoc: true },
  )

  assert({
    given: 'an extension-relayed tab whose initial Page detaches on navigation and re-attaches on the loaded Doc',
    should: 'return the re-attached Page and reuse it without reloading on subsequent comments for the same Doc',
    actual: [recovered === reattachedDoc, reused === reattachedDoc, gotoCount],
    expected: [true, true, 0],
  })
})
