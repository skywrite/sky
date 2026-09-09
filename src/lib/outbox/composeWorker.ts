import * as config from '#config'
import { env } from '#shared/sys/mod.ts'
import { createOutboxHost } from '../../service/handler/outbox/createOutboxHost.ts'
import type { ComposeProcessInput } from './composeProcess.ts'
import type { OutboxRecord } from './types.ts'

export default async function composeWorker(input: ComposeProcessInput): Promise<OutboxRecord> {
  const host = createOutboxHost(config, env.toObject(), { composeInProcess: true })
  return host.compose!(input.id, input.revision, input.draft, input.instruction, input.reviewedChanges)
}
