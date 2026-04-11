import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'

const params = {
  token: Flag.string('Slack user token (or set SLACK_USER_TOKEN env var)', { short: 't' }),
  required: Flag.string('Comma-separated scopes to verify'),
  debug: Flag.boolean('Show debug output'),
}

type Params = InferParams<typeof params>

type Result = {
  tokenType: string
  teamId?: string
  teamName?: string
  userId?: string
  scopes: string[]
  acceptedScopes: string[]
  requiredScopes: string[]
  missingRequiredScopes: string[]
}

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'slack:api:scopes': {
      params: Params
      result: Result
    }
  }
}

export default class SlackApiScopesTask extends Command {
  static override description: CommandDescription = {
    name: 'slack:api:scopes',
    description: 'Show active OAuth scopes for the configured Slack token.',
    descriptionLong: [
      'Calls Slack auth.test and reads scope headers from the HTTP response.',
      'Use --required to verify expected scopes and show what is missing.',
    ],
    usage: [
      'sky slack:api:scopes',
      'sky slack:api:scopes --required search:read',
      'sky slack:api:scopes --required channels:read,channels:history,search:read',
    ],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output, env } = context
    const token = args.token || env.SLACK_USER_TOKEN
    const debug = args.debug ?? false

    if (!token) {
      return CommandResult.fail(
        'No Slack token provided. Use --token flag or set SLACK_USER_TOKEN environment variable.',
      )
    }

    const tokenType = token.split('-')[0] || 'unknown'
    const requiredScopes = sortScopes(parseScopes(args.required))

    try {
      const response = await fetch('https://slack.com/api/auth.test', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (!response.ok) {
        return CommandResult.fail(`Slack API request failed with HTTP ${response.status}`)
      }

      const authResult = (await response.json()) as {
        ok?: boolean
        error?: string
        user_id?: string
        team_id?: string
        team?: string
      }

      if (!authResult.ok) {
        return CommandResult.fail(`Slack auth.test failed: ${authResult.error || 'unknown_error'}`)
      }

      const scopes = sortScopes(parseScopes(response.headers.get('x-oauth-scopes') || ''))
      const acceptedScopes = sortScopes(parseScopes(response.headers.get('x-accepted-oauth-scopes') || ''))
      const missingRequiredScopes = sortScopes(requiredScopes.filter((scope) => !scopes.includes(scope)))

      output.log('')
      output.log('Slack API Scopes')
      output.log('')
      output.log(`Token type: ${tokenType}`)
      output.log(`Team: ${authResult.team || '-'} (${authResult.team_id || '-'})`)
      output.log(`User ID: ${authResult.user_id || '-'}`)
      output.log('')
      output.log(`Scopes (${scopes.length}):`)
      if (scopes.length === 0) {
        output.log('  (none returned)')
      } else {
        for (const scope of scopes) output.log(`  - ${scope}`)
      }

      if (acceptedScopes.length > 0) {
        output.log('')
        output.log(`Accepted scopes (${acceptedScopes.length}):`)
        for (const scope of acceptedScopes) output.log(`  - ${scope}`)
      } else if (debug) {
        output.log('')
        output.log('Accepted scopes: (header not present)')
      }

      if (requiredScopes.length > 0) {
        output.log('')
        output.log(`Required scopes (${requiredScopes.length}):`)
        for (const scope of requiredScopes) output.log(`  - ${scope}`)

        output.log('')
        if (missingRequiredScopes.length === 0) {
          output.log('All required scopes are present.')
        } else {
          output.log(`Missing scopes (${missingRequiredScopes.length}):`)
          for (const scope of missingRequiredScopes) output.log(`  - ${scope}`)
        }
      }

      return CommandResult.success({
        tokenType,
        teamId: authResult.team_id,
        teamName: authResult.team,
        userId: authResult.user_id,
        scopes,
        acceptedScopes,
        requiredScopes,
        missingRequiredScopes,
      })
    } catch (error) {
      return CommandResult.error(error as Error, 'Failed to fetch Slack token scopes')
    }
  }
}

function parseScopes(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0)
}

function sortScopes(scopes: string[]): string[] {
  return [...scopes].sort((a, b) => a.localeCompare(b))
}
