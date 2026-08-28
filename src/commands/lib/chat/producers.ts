/**
 * The chat's query pipeline as commands. ChatContext asks three questions
 * — what to fetch for a first message, whether the query set should
 * change, and what a query returns — and every host answers them by
 * running the same three commands. Both the CLI and the service host build
 * their session's producers here, so the two never diverge on how a
 * question becomes documents.
 */

import type { CommandService } from '#commands/mod.ts'
import type { ContextProducers } from '#shared/models/Chat/ChatContext/mod.ts'

export function contextProducers(tasks: CommandService): ContextProducers {
  return {
    produceInitialQuery: async (userMessage) => {
      const r = await tasks.run('ai:context:files', {
        _: ['ai:context:files', userMessage],
        server: true,
      })
      return r.status === 'success'
        ? {
            ok: true,
            value: {
              paths: r.data?.paths ?? [],
              query: r.data?.query,
              truncations: r.data?.truncations,
              since: r.data?.since,
              until: r.data?.until,
              start: r.data?.start,
            },
          }
        : { ok: false, message: r.message ?? 'ai:context:files failed' }
    },
    evolveQueries: async (userMessage, queries, recentConversation) => {
      const r = await tasks.run<{ queries: string[]; changed: boolean }>('ai:context:evolve', {
        _: ['ai:context:evolve', userMessage],
        queries: JSON.stringify(queries),
        conversation: JSON.stringify(recentConversation),
      })
      return r.status === 'success'
        ? { ok: true, value: { queries: r.data?.queries ?? [], changed: r.data?.changed ?? false } }
        : { ok: false, message: r.message ?? 'ai:context:evolve failed' }
    },
    executeQuery: async (query) => {
      const r = await tasks.run('markdown:sel', { graphql: query, raw: true, server: 'true' })
      return r.status === 'success'
        ? { ok: true, value: { paths: r.data?.paths ?? [], truncations: r.data?.truncations } }
        : { ok: false, message: r.message ?? 'Context query failed' }
    },
  }
}
