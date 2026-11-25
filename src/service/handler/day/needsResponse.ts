import * as path from 'node:path'
import { Hono } from 'hono'
import { resolveGmailClient } from '#commands/all/google/email/lib/resolveGmailClient.ts'
import { getThread, hasGmailScope, listAccountEmails, listThreads, loadAccountTokens } from '#lib/google/mod.ts'
import { type MacSenderLookup, openMacSenderLookup } from '#lib/macMessages/mod.ts'
import {
  createDayResolver,
  createNeedsResponseHost,
  createNeedsResponseScreen,
  type GmailInboxClient,
  type NeedsResponseHost,
} from '#lib/needsResponse/mod.ts'
import { KeychainSecretsProvider } from '#lib/secrets/KeychainSecretsProvider.ts'
import type { SecretsProvider } from '#lib/secrets/SecretsProvider.ts'
import { decisionModel } from '#shared/ai/decisions.ts'
import type * as Config from '#shared/config.ts'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { fetchNowSync, readDaySync } from '#shared/nbfs/mod.ts'
import { Instant, PlainDate } from '#universal/dates/nbdt/mod.ts'
import { createScoreLookup } from '../../scoring/contacts.ts'
import type { Store } from '../../store.ts'
import { beeperOutboxClient, openBeeperChat, outboxErrorFromBeeper } from '../outbox/beeper.ts'
import { loadOwnerNames } from './record.ts'

function createGmailInboxClient(secrets: SecretsProvider): GmailInboxClient {
  return {
    listAccounts: async () => {
      const emails = await listAccountEmails(secrets)
      const runnable: string[] = []
      for (const email of emails) {
        const tokens = await loadAccountTokens(secrets, email)
        if (tokens && hasGmailScope(tokens)) runnable.push(email)
      }
      return runnable
    },
    listThreads: async (account, opts) => {
      const client = await resolveGmailClient({ secrets, requested: account, interactive: false })
      return listThreads(client, { q: opts.q, limit: opts.limit })
    },
    getThread: async (account, threadId, format) => {
      const client = await resolveGmailClient({ secrets, requested: account, interactive: false })
      return getThread(client, threadId, { format })
    },
  }
}

export function createServiceNeedsResponseHost(options: {
  config: Pick<
    typeof Config,
    'DIR_BASE' | 'DIR_TIME' | 'DIR_STATE' | 'DIR_USER_DATA' | 'DIR_STATE_FOLLOW_SLACK_ACTIVE' | 'FILE_ABOUT_ME'
  >
  store: Store
  markdownStore: () => MarkdownStore | null
  ownerAddresses?: () => Promise<string[]>
  secrets?: SecretsProvider
}): NeedsResponseHost {
  const secrets = options.secrets ?? new KeychainSecretsProvider()
  const scoreLookup = createScoreLookup(options.store)
  const gmail = createGmailInboxClient(secrets)

  // Refresh Mac Contacts lookup every 10 minutes in the background so newly added contacts take effect cleanly.
  const MAC_CONTACTS_TTL_MS = 10 * 60_000
  let macContacts: MacSenderLookup | null = null
  let macContactsLoadedAt = 0
  let macContactsLoading: Promise<void> | null = null
  const refreshMacContacts = () => {
    const now = performance.now()
    if (macContactsLoading || (macContactsLoadedAt > 0 && now - macContactsLoadedAt < MAC_CONTACTS_TTL_MS)) return
    macContactsLoading = openMacSenderLookup()
      .then((lookup) => {
        macContacts = lookup
        macContactsLoadedAt = performance.now()
      })
      .catch(() => {
        macContactsLoadedAt = performance.now()
      })
      .finally(() => {
        macContactsLoading = null
      })
  }
  refreshMacContacts()

  return createNeedsResponseHost({
    stateDir: path.join(options.config.DIR_USER_DATA, 'state', 'needs-response'),
    markdownBaseDir: options.config.DIR_BASE,
    timeDir: options.config.DIR_TIME,
    slackDmsDir: path.join(options.config.DIR_STATE, 'slack', 'dms'),
    slackFollowActiveDir: options.config.DIR_STATE_FOLLOW_SLACK_ACTIVE,
    getOwnerNames: () => loadOwnerNames(options.config.FILE_ABOUT_ME),
    getOwnerAddresses: options.ownerAddresses,
    getSenderLookup: () => {
      refreshMacContacts()
      return {
        people: options.markdownStore()?.people ?? null,
        scoreLookup,
        macContacts,
      }
    },
    getTimezone: () => fetchNowSync().timezone,
    // The score follows notebook days: a day stays open past midnight until the next one is started.
    getDayOf: () =>
      createDayResolver({
        timezone: fetchNowSync().timezone,
        startOf: (date) => {
          try {
            return readDaySync(new PlainDate(date), options.config.DIR_TIME).started?.epochMilliseconds ?? null
          } catch {
            return null
          }
        },
      }),
    today: () => fetchNowSync().plainDateTime.plainDate,
    now: () => Instant.fromEpochMilliseconds(fetchNowSync().epochMilliseconds),
    gmail,
    createScreen: async () => {
      const model = decisionModel('default', { secrets })
      if (!(await model.hasKey())) return null
      return createNeedsResponseScreen(model)
    },
    openBeeper: async (chatId) => {
      try {
        const client = await beeperOutboxClient(secrets)
        await openBeeperChat(client, { medium: 'Beeper', account: '', chat: chatId })
      } catch (error) {
        throw outboxErrorFromBeeper(error)
      }
    },
  })
}

function checkSameOrigin(req: Request): string | null {
  const origin = req.headers.get('Origin')
  if ((origin && origin !== new URL(req.url).origin) || req.headers.get('Sec-Fetch-Site') === 'cross-site') {
    return 'Open Needs response from the Sky app.'
  }
  return null
}

/** HTTP routes mounted under `/day` for the Today Needs Response section. */
export function createNeedsResponseRoutes(host: NeedsResponseHost): Hono {
  const app = new Hono()

  app.get('/needs-response', async (c) => {
    const result = await host.list()
    host.refreshIfStale()
    return c.json(result)
  })

  app.get('/needs-response/score', async (c) => c.json(await host.score()))

  app.post('/needs-response/refresh', async (c) => {
    const blocked = checkSameOrigin(c.req.raw)
    if (blocked) return c.json({ error: blocked }, 403)
    const report = await host.scan()
    const list = await host.list()
    return c.json({ ...list, report })
  })

  app.post('/needs-response/dismiss', async (c) => {
    const blocked = checkSameOrigin(c.req.raw)
    if (blocked) return c.json({ error: blocked }, 403)
    if (!c.req.header('Content-Type')?.startsWith('application/json')) {
      return c.json({ error: 'Expected a JSON request.' }, 400)
    }
    const body = (await c.req.json().catch(() => null)) as { id?: unknown; version?: unknown; how?: unknown } | null
    if (!body || typeof body.id !== 'string' || !body.id || typeof body.version !== 'string' || !body.version) {
      return c.json({ error: 'Choose an item to clear.' }, 400)
    }
    // The tick says the message was answered and earns its points; the X clears it for nothing.
    return c.json(await host.dismiss(body.id, body.version, body.how === 'responded' ? 'responded' : 'dismissed'))
  })

  app.post('/needs-response/undismiss', async (c) => {
    const blocked = checkSameOrigin(c.req.raw)
    if (blocked) return c.json({ error: blocked }, 403)
    if (!c.req.header('Content-Type')?.startsWith('application/json')) {
      return c.json({ error: 'Expected a JSON request.' }, 400)
    }
    const body = (await c.req.json().catch(() => null)) as { id?: unknown } | null
    if (!body || typeof body.id !== 'string' || !body.id) {
      return c.json({ error: 'Choose an item to restore.' }, 400)
    }
    return c.json(await host.undismiss(body.id))
  })

  app.post('/needs-response/open', async (c) => {
    const blocked = checkSameOrigin(c.req.raw)
    if (blocked) return c.json({ error: blocked }, 403)
    if (!c.req.header('Content-Type')?.startsWith('application/json')) {
      return c.json({ error: 'Expected a JSON request.' }, 400)
    }
    const body = (await c.req.json().catch(() => null)) as { id?: unknown } | null
    if (!body || typeof body.id !== 'string' || !body.id) {
      return c.json({ error: 'Choose a conversation to open.' }, 400)
    }
    try {
      await host.openInApp(body.id)
      return c.json({ ok: true })
    } catch (error) {
      const status =
        typeof (error as { status?: unknown })?.status === 'number' ? (error as { status: number }).status : 400
      return c.json({ error: error instanceof Error ? error.message : String(error) }, status as 400 | 409 | 503)
    }
  })

  return app
}

export type { NeedsResponseHost }
