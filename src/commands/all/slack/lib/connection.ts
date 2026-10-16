import { createHash } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { readJson, withProcessLock, writeJson } from '#lib/jobs/files.ts'
import { KeychainAccessError } from '#lib/secrets/keychainProtocol.ts'

export type SlackFailure = 'keychain' | 'expired' | 'missing' | 'network' | 'unavailable' | 'paused'
export type SlackIssue = { reason: SlackFailure; workspace?: string; retryAt?: number }
export type SlackCommandResult = {
  success: boolean
  code: number
  stdout: string
  stderr: string
  issue?: SlackIssue
}
export type SlackCredentials = { workspace: string; token: string; cookie?: string; revision?: number }
type ConnectionState = { revision: number; issue: SlackIssue | null }
const FAILURE_REASONS: SlackFailure[] = ['keychain', 'expired', 'missing', 'network', 'unavailable', 'paused']
export type SlackWorkspace = {
  workspace_url: string
  workspace_name?: string
  team_id?: string
  auth: { auth_type: 'browser' | 'standard'; token?: string; xoxc_token?: string; xoxd_cookie?: string }
}
export type SlackCredentialConfig = { default_workspace_url?: string; workspaces: SlackWorkspace[] }

export interface SlackConnectionHost {
  stateDir: string
  configuredWorkspace?: string
  macOS: boolean
  config: () => Promise<SlackCredentialConfig>
  secret: (account: string, interactive: boolean) => Promise<string | null>
  restoreKeychain: () => Promise<void>
  run: (args: string[], credentials: SlackCredentials) => Promise<SlackCommandResult>
  importBrave: () => Promise<SlackCommandResult>
  now: () => number
}

export class SlackConnectionError extends Error {
  constructor(readonly issue: SlackIssue) {
    super(slackIssueMessage(issue))
    this.name = 'SlackConnectionError'
  }
}

export function slackIssueMessage(issue: SlackIssue): string {
  const name = issue.workspace ? `Slack (${new URL(issue.workspace).hostname})` : 'Slack'
  if (issue.reason === 'network') return `${name} is temporarily unreachable. Sky will retry automatically.`
  const why = {
    keychain: 'macOS is not allowing access to its saved credentials',
    expired: 'Slack rejected its saved session',
    missing: 'no usable saved credentials are available',
    unavailable: 'Sky could not start its protected Slack connection',
    paused: 'syncing has been paused',
  }[issue.reason]
  return `${name} syncing is paused because ${why}. Open Settings → Connections → Slack to restore access.`
}

/** Credentials may only be sent to a Slack workspace, never a URL from arbitrary command arguments. */
export function slackWorkspaceUrl(value: string): string {
  try {
    const url = new URL(value)
    if (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      (url.hostname.endsWith('.slack.com') || url.hostname.endsWith('.slack-gov.com')) &&
      url.hostname !== 'app.slack.com'
    )
      return url.origin
  } catch {
    /* A workspace selector may also be a name; it is resolved against saved metadata below. */
  }
  throw new SlackConnectionError({ reason: 'missing' })
}

function usable(value: string | null | undefined): string | undefined {
  return value && value !== '__KEYCHAIN__' ? value : undefined
}

function expired(result: SlackCommandResult): boolean {
  return /\b(invalid_auth|token_expired|token_revoked|account_inactive|not_authed)\b/i.test(
    result.stderr + result.stdout,
  )
}

/** One boundary for CLI calls, direct API reads, Settings checks and explicit recovery. */
export class SlackConnection {
  private reading: Promise<unknown> = Promise.resolve()
  private recovering?: Promise<SlackCommandResult>
  private recoveryWorkspace?: string

  constructor(private readonly host: SlackConnectionHost) {}

  private file(workspace?: string): string {
    const key = createHash('sha256')
      .update(workspace ?? 'default')
      .digest('hex')
    return path.join(this.host.stateDir, `${key}.json`)
  }

  private async select(selector?: string): Promise<SlackWorkspace> {
    const config = await this.host.config()
    const selected = selector || this.host.configuredWorkspace || config.default_workspace_url
    const workspaces = config.workspaces.map((entry) => ({
      ...entry,
      workspace_url: slackWorkspaceUrl(entry.workspace_url),
    }))
    let matches: SlackWorkspace[]
    if (selected) {
      if (/^https?:\/\//i.test(selected)) {
        const url = slackWorkspaceUrl(selected)
        matches = workspaces.filter((entry) => entry.workspace_url === url)
      } else {
        const key = selected.toLowerCase()
        matches = workspaces.filter(
          (entry) =>
            entry.team_id === selected ||
            entry.workspace_url.toLowerCase().includes(key) ||
            entry.workspace_name?.toLowerCase().includes(key),
        )
      }
    } else matches = workspaces
    if (matches.length !== 1) throw new SlackConnectionError({ reason: 'missing' })
    return matches[0]
  }

  private selector(args: string[]): string | undefined {
    const flag = args.indexOf('--workspace')
    if (flag >= 0) return args[flag + 1]
    const inline = args.find((arg) => arg.startsWith('--workspace='))
    if (inline) return inline.slice('--workspace='.length)
    // Only targets are inspected: a draft's text can itself contain another workspace's URL.
    const target = args[0] === 'message' && args[1] === 'draft' ? args[3] : args[2]
    if (!target) return undefined
    try {
      const url = new URL(target)
      if (url.hostname === 'app.slack.com') return url.pathname.split('/')[2]
      if (url.protocol === 'slack:') return url.searchParams.get('team') ?? undefined
      if (url.hostname.endsWith('.slack.com') || url.hostname.endsWith('.slack-gov.com'))
        return slackWorkspaceUrl(target)
    } catch {
      /* Channel ids, names and user ids are resolved by agent-slack. */
    }
    return undefined
  }

  private async state(file: string): Promise<ConnectionState> {
    const state = await readJson<ConnectionState>(file)
    if (!state) return { revision: 0, issue: null }
    const issue = state.issue
    if (
      !Number.isSafeInteger(state.revision) ||
      state.revision < 0 ||
      (issue !== null &&
        (!issue ||
          !FAILURE_REASONS.includes(issue.reason) ||
          (issue.retryAt !== undefined && !Number.isFinite(issue.retryAt))))
    )
      throw new SlackConnectionError({ reason: 'unavailable' })
    if (issue?.workspace) slackWorkspaceUrl(issue.workspace)
    return state
  }

  private active(issue: SlackIssue | null): SlackIssue | null {
    return issue?.retryAt && issue.retryAt <= this.host.now() ? null : issue
  }

  /** Short atomic updates fence failures from requests started before a pause or recovery. */
  private async update(workspace: string | undefined, issue: SlackIssue | null, expected?: number): Promise<number> {
    const file = this.file(workspace)
    return withProcessLock(`${file}.lock`, async () => {
      const state = await this.state(file)
      if (expected !== undefined && state.revision !== expected) return state.revision
      const revision = state.revision + 1
      await writeJson(file, { revision, issue } satisfies ConnectionState)
      return revision
    })
  }

  private block(issue: SlackIssue, expected?: number): Promise<number> {
    return this.update(issue.workspace, issue, expected)
  }

  async pause(selector?: string): Promise<void> {
    const workspace = (await this.select(selector)).workspace_url
    await this.block({ reason: 'paused', workspace })
  }

  /** Reads pause metadata only; the app shell must never touch credentials while polling. */
  async issues(): Promise<SlackIssue[]> {
    let files: string[]
    try {
      files = await readdir(this.host.stateDir)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const issues = await Promise.all(
      files
        .filter((file) => /^[a-f0-9]{64}\.json$/.test(file))
        .map(async (file) => {
          try {
            return this.active((await this.state(path.join(this.host.stateDir, file))).issue)
          } catch {
            return { reason: 'unavailable' } satisfies SlackIssue
          }
        }),
    )
    return issues.filter((issue): issue is SlackIssue => issue !== null)
  }

  async reportFailure(credentials: SlackCredentials, reason: 'expired' | 'network'): Promise<void> {
    await this.block(
      {
        reason,
        workspace: slackWorkspaceUrl(credentials.workspace),
        ...(reason === 'network' ? { retryAt: this.host.now() + 60_000 } : {}),
      },
      credentials.revision,
    )
  }

  private async readCredentials(
    selector: string | undefined,
    interactive: boolean,
    restoring: boolean,
  ): Promise<SlackCredentials> {
    if (!restoring) {
      const issue = this.active((await this.state(this.file())).issue)
      if (issue) throw new SlackConnectionError(issue)
    }
    const entry = await this.select(selector)
    const workspace = entry.workspace_url
    const state = await this.state(this.file(workspace))
    if (!restoring) {
      const issue = this.active(state.issue)
      if (issue) throw new SlackConnectionError(issue)
    }
    try {
      const browser = entry.auth.auth_type === 'browser'
      const account = `${browser ? 'xoxc' : 'token'}:${workspace}`
      const token =
        usable(this.host.macOS ? await this.host.secret(account, interactive) : null) ??
        usable(browser ? entry.auth.xoxc_token : entry.auth.token)
      // Stop at the first failed read; a locked token must not trigger another cookie lookup.
      if (!token) throw new SlackConnectionError({ reason: 'missing', workspace })
      const cookie = browser
        ? (usable(this.host.macOS ? await this.host.secret('xoxd', interactive) : null) ??
          usable(entry.auth.xoxd_cookie))
        : undefined
      if (browser && !cookie) throw new SlackConnectionError({ reason: 'missing', workspace })
      return { workspace, token, cookie, revision: state.revision }
    } catch (error) {
      const issue: SlackIssue =
        error instanceof SlackConnectionError
          ? error.issue
          : {
              reason: error instanceof KeychainAccessError ? 'keychain' : 'unavailable',
              workspace,
            }
      if (!restoring) await this.block(issue, state.revision)
      throw new SlackConnectionError(issue)
    }
  }

  credentials(selector?: string): Promise<SlackCredentials> {
    // Share the first failure with queued readers before any of them can ask the OS again.
    const work = this.reading.then(() => this.readCredentials(selector, false, false))
    this.reading = work.catch(() => {})
    return work
  }

  private failure(error: unknown): SlackCommandResult {
    const issue: SlackIssue = error instanceof SlackConnectionError ? error.issue : { reason: 'unavailable' }
    return { success: false, code: 1, stdout: '', stderr: slackIssueMessage(issue), issue }
  }

  private async execute(args: string[], credentials: SlackCredentials, restoring = false): Promise<SlackCommandResult> {
    const result = await this.host.run(args, credentials)
    if (result.success) return result
    // Third-party diagnostics must never echo credentials into Sky's logs or model context.
    for (const secret of [
      credentials.token,
      credentials.cookie,
      credentials.cookie && encodeURIComponent(credentials.cookie),
    ]) {
      if (!secret) continue
      result.stderr = result.stderr.replaceAll(secret, '[redacted]')
      result.stdout = result.stdout.replaceAll(secret, '[redacted]')
    }
    let issue: SlackIssue | undefined
    if (expired(result)) issue = { reason: 'expired', workspace: credentials.workspace }
    else if (/sandbox-exec:|sandbox_apply|ENOENT|EBADF|EACCES/i.test(result.stderr))
      issue = { reason: 'unavailable', workspace: credentials.workspace }
    else if (/fetch failed|timed? out|ECONN|ENOTFOUND|rate.?limit|retry-after|\b429\b/i.test(result.stderr))
      issue = { reason: 'network', workspace: credentials.workspace, retryAt: this.host.now() + 60_000 }
    if (!issue) return result
    if (!restoring) await this.block(issue, credentials.revision)
    return this.failure(new SlackConnectionError(issue))
  }

  async run(args: string[]): Promise<SlackCommandResult> {
    try {
      if (args[0] === 'auth' && args[1] === 'whoami') {
        const config = await this.host.config()
        return {
          success: true,
          code: 0,
          stderr: '',
          stdout: JSON.stringify({
            default_workspace_url: config.default_workspace_url,
            workspaces: config.workspaces.map(({ workspace_url, workspace_name, auth }) => ({
              workspace_url,
              workspace_name,
              auth_type: auth.auth_type,
            })),
          }),
        }
      }
      if (args[0] === 'auth' && args[1] !== 'test') throw new SlackConnectionError({ reason: 'paused' })
      const credentials = await this.credentials(this.selector(args))
      return await this.execute(args, credentials)
    } catch (error) {
      return this.failure(error)
    }
  }

  /** Only an explicit user action reaches this method. Other processes stay paused during recovery. */
  recover(requestedWorkspace?: string): Promise<SlackCommandResult> {
    if (this.recovering)
      return this.recoveryWorkspace === requestedWorkspace
        ? this.recovering
        : Promise.resolve(this.failure(new SlackConnectionError({ reason: 'paused' })))
    this.recoveryWorkspace = requestedWorkspace
    this.recovering = withProcessLock(path.join(this.host.stateDir, 'recovery'), async () => {
      let selector: string | undefined
      try {
        selector = (await this.select(requestedWorkspace)).workspace_url
      } catch {
        /* First connection needs an import. */
      }
      const revision = await this.block({ reason: 'paused', workspace: selector })
      let credentials: SlackCredentials | undefined
      try {
        try {
          credentials = await this.readCredentials(selector ?? requestedWorkspace, false, true)
        } catch (error) {
          if (!(error instanceof SlackConnectionError)) throw error
          if (error.issue.reason === 'keychain') {
            await this.host.restoreKeychain()
            credentials = await this.readCredentials(selector ?? requestedWorkspace, true, true)
          } else if (error.issue.reason !== 'missing') throw error
        }
        if (credentials) {
          const checked = await this.execute(['auth', 'test', '--workspace', credentials.workspace], credentials, true)
          if (checked.success) {
            await this.update(selector, null, revision)
            return checked
          }
          if (checked.issue?.reason !== 'expired') {
            await this.block(checked.issue ?? { reason: 'unavailable', workspace: selector }, revision)
            return checked
          }
        }
        // Re-import only after missing/expired credentials, never as a response to denied Keychain access.
        const imported = await this.host.importBrave()
        if (!imported.success) throw new SlackConnectionError({ reason: 'missing', workspace: selector })
        credentials = await this.readCredentials(selector ?? requestedWorkspace, this.host.macOS, true)
        const checked = await this.execute(['auth', 'test', '--workspace', credentials.workspace], credentials, true)
        // A first connection starts with a global pause until an imported workspace exists.
        if (checked.success) await this.update(selector, null, revision)
        else await this.block({ ...(checked.issue ?? { reason: 'unavailable' }), workspace: selector }, revision)
        return checked
      } catch (error) {
        const issue: SlackIssue =
          error instanceof SlackConnectionError
            ? error.issue
            : {
                reason: error instanceof KeychainAccessError ? 'keychain' : 'unavailable',
                workspace: selector,
              }
        await this.block({ ...issue, workspace: selector }, revision)
        return this.failure(new SlackConnectionError(issue))
      }
    })
      .catch((error: unknown) => this.failure(error))
      .finally(() => {
        this.recovering = undefined
      })
    return this.recovering
  }
}
