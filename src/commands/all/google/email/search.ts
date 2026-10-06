import { z } from 'zod'
import { AIChatTool } from '#commands/lib/AIChatTool.ts'
import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { AccountResolutionError, getThread, listThreads } from '#lib/google/mod.ts'
import { Instant } from '#universal/dates/nbdt/mod.ts'
import { gmailClientsToList } from './lib/resolveGmailClient.ts'

const params = {
  query: Arg.string('Gmail search query, such as subject:Atlas or from:jane@example.com'),
  account: Flag.string('Search one connected account; omitted, search every connected mailbox', { short: 'a' }),
  limit: Flag.number('Maximum matching threads per mailbox', {
    default: () => 20,
    schema: z.coerce.number().int().min(1).max(100),
  }),
}
type Params = InferParams<typeof params>
type SearchThread = {
  threadId: string
  account: string
  subject: string
  from: string
  date?: string
  snippet?: string
  messages: number
}
type SearchAccount = { account: string; threads: number; hasMore: boolean; error?: string }
type Result = { query: string; threads: SearchThread[]; accounts: SearchAccount[]; complete: boolean }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'google:email:search': { params: Params; result: Result }
  }
}

@AIChatTool({ needsApproval: false })
export default class GoogleEmailSearch extends Command {
  static override description: CommandDescription = {
    name: 'google:email:search',
    description:
      'Search connected Gmail mailboxes by Gmail query (words, subject:, from:, to:, after:, before:). ' +
      'Includes archived and sent mail, not just the inbox or followed threads. Use this to find a conversation ' +
      'before google:email:read; read every relevant matching thread when a conversation spans several threads. ' +
      'Returns threadId and account for reading. complete=false means a mailbox failed or a result limit was hit; ' +
      'narrow the query or increase limit before claiming complete coverage. Read-only; no browser or sign-in needed.',
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const query = args.query.trim()
    if (!query) return CommandResult.fail('Provide a Gmail search query.')
    let listing
    try {
      listing = await gmailClientsToList({ secrets: context.secrets, requested: args.account })
    } catch (error) {
      if (error instanceof AccountResolutionError) return CommandResult.fail(error.message)
      throw error
    }
    const threads: SearchThread[] = []
    const accounts: SearchAccount[] = listing.skipped.map(({ account, reason }) => ({
      account,
      threads: 0,
      hasMore: false,
      error: reason,
    }))
    for (const client of listing.clients) {
      const result: SearchAccount = { account: client.email, threads: 0, hasMore: false }
      try {
        const refs = await listThreads(client, { q: query, limit: args.limit + 1 })
        result.hasMore = refs.length > args.limit
        for (const ref of refs.slice(0, args.limit)) {
          const messages = await getThread(client, ref.id, { format: 'metadata' })
          if (!messages.length) continue
          const newest = messages.at(-1)!
          threads.push({
            threadId: ref.id,
            account: client.email,
            subject: messages[0]!.subject || '(no subject)',
            from: newest.from?.name || newest.from?.address || '(unknown)',
            ...(newest.date
              ? { date: Instant.fromEpochMilliseconds(Number(newest.date)).toString({ smallestUnit: 'millisecond' }) }
              : {}),
            snippet: newest.snippet,
            messages: messages.length,
          })
          result.threads++
        }
      } catch (error) {
        result.error = error instanceof Error ? error.message : String(error)
      }
      accounts.push(result)
    }
    if (!accounts.some((account) => !account.error))
      return CommandResult.fail(accounts.map((account) => `${account.account}: ${account.error}`).join('\n'))
    const complete = accounts.every((account) => !account.error && !account.hasMore)
    context.output.log(
      `Found ${threads.length} matching thread(s) across ${accounts.length} mailbox(es).${complete ? '' : ' Search coverage is incomplete; check accounts.'}`,
    )
    return CommandResult.success({ query, threads, accounts, complete })
  }
}
