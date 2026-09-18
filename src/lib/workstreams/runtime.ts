import type * as Config from '#config'
import { createOutboxRuntime } from '#lib/outbox/runtime.ts'
import { KeychainSecretsProvider } from '#lib/secrets/KeychainSecretsProvider.ts'
import { fetchNowSync } from '#shared/nbfs/mod.ts'
import { env } from '#shared/sys/mod.ts'
import { createReportDelivery } from './delivery.ts'
import { createReportTransport } from './deliveryTransport.ts'
import { createWorkstreamOutbox } from './outbox.ts'
import type { PrepareWorkstreamCommunication } from './runner.ts'
import { createWorkstreamStorage } from './storage.ts'
import { WorkstreamStore, workstreamNow } from './store.ts'

export function createWorkstreamsRuntime(config: typeof Config): {
  store: WorkstreamStore
  prepareCommunication: PrepareWorkstreamCommunication
  readCommunications: (id: string) => Promise<Record<string, unknown>[]>
  reportDelivery: ReturnType<typeof createReportDelivery>
} {
  const storage = createWorkstreamStorage(config)
  const store = new WorkstreamStore(
    storage.dir,
    storage.stateDir,
    config.DIR_BASE,
    () => fetchNowSync().plainDateTime.plainDate.ymd,
    storage.contentRoot,
    storage.initialize,
  )
  const outbox = createOutboxRuntime(config)
  const communications = createWorkstreamOutbox({ workstreams: store, ...outbox, now: workstreamNow })
  const reportDelivery = createReportDelivery({
    store,
    outbox: communications,
    outboxStore: outbox.store,
    transport: createReportTransport({
      secrets: new KeychainSecretsProvider(),
      slackToken: env.get('SLACK_USER_TOKEN'),
    }),
    now: workstreamNow,
  })
  return {
    store,
    prepareCommunication: communications.prepare,
    readCommunications: communications.list,
    reportDelivery,
  }
}
