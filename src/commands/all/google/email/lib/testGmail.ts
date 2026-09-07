import { spyOn } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import * as prompts from '@clack/prompts'
import CommandContext, { CommandPlatform } from '#commands/lib/core/CommandContext.ts'
import CommandService from '#commands/lib/core/CommandService.ts'
import type { CommandResult } from '#commands/mod.ts'
import * as config from '#config'
import { GMAIL_SCOPE } from '#lib/google/gmail.ts'
import { saveAccountTokens, saveOAuthClient } from '#lib/google/tokens.ts'
import { assert } from '#test'

export function commandArgs<T>(context: CommandContext, args: T) {
  return { args, context, tasks: new CommandService(context), rawArgs: { _: [] } }
}

export async function withGmail(
  respond: (url: URL, init?: RequestInit) => unknown,
  run: (context: CommandContext) => Promise<void>,
): Promise<void> {
  const followDir = await mkdtemp('/tmp/sky-gmail-command-test-')
  const context = CommandContext.test({ ...config, DIR_STATE_FOLLOW_EMAIL_ACTIVE: followDir }).fork({
    platform: CommandPlatform.Server,
  })
  const fetchMock = spyOn(globalThis, 'fetch').mockImplementation((async (input: unknown, init?: RequestInit) => {
    const body = respond(new URL(String(input)), init)
    return body instanceof Response ? body : new Response(JSON.stringify(body))
  }) as typeof fetch)
  try {
    await saveOAuthClient(context.secrets, { clientId: 'id', clientSecret: 'secret' })
    await saveAccountTokens(context.secrets, 'jane@example.com', {
      refreshToken: 'rt',
      accessToken: 'at',
      scopes: [GMAIL_SCOPE],
    })
    await run(context)
  } finally {
    fetchMock.mockRestore()
    await rm(followDir, { recursive: true, force: true })
  }
}

export async function assertAccountAmbiguity(run: (context: CommandContext) => Promise<CommandResult>): Promise<void> {
  let requests = 0
  const select = spyOn(prompts, 'select').mockResolvedValue('jane@example.com')
  try {
    await withGmail(
      () => {
        requests++
        return new Response('{}', { status: 400 })
      },
      async (context) => {
        await saveAccountTokens(context.secrets, 'bob@example.com', {
          refreshToken: 'rt',
          accessToken: 'at',
          scopes: [GMAIL_SCOPE],
        })
        for (const options of [
          { platform: CommandPlatform.Server, compositionDepth: 0 },
          { platform: CommandPlatform.Console, compositionDepth: 1 },
          { platform: CommandPlatform.Test, compositionDepth: 0 },
        ]) {
          const result = await run(context.fork(options))
          assert({
            given: `${options.platform} at depth ${options.compositionDepth} with two accounts`,
            should: 'fail with account choices before making a request or opening a picker',
            expected: true,
            actual:
              result.failed &&
              !!result.message?.includes('jane@example.com') &&
              !!result.message?.includes('bob@example.com'),
          })
        }
        assert({
          given: 'ambiguous accounts in noninteractive calls',
          should: 'never prompt or access Gmail',
          expected: [0, 0],
          actual: [select.mock.calls.length, requests],
        })
      },
    )
  } finally {
    select.mockRestore()
  }
}
