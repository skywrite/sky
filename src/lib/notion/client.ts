import type { SecretsProvider } from '#lib/secrets/SecretsProvider.ts'
import { NOTION_NOT_CONNECTED, NOTION_SIGNED_OUT, NOTION_UNREACHABLE, NotionError } from './errors.ts'
import { grantExpired, NOTION_MCP_URL, type NotionGrant, refreshNotionGrant } from './oauth.ts'
import { loadNotionGrant, saveNotionGrant } from './secrets.ts'

/**
 * Notion through the MCP server it runs for AI apps. A call is one JSON-RPC
 * message posted over HTTP; Notion answers with JSON, or with a short event
 * stream that may carry progress notes before the answer. The first call
 * opens a session, and a session Notion has forgotten is opened again. A
 * refused token is renewed once with the refresh token, and the keychain
 * keeps the newest grant, before the call counts as signed out.
 *
 * Notion's tool names live in this file alone: the server is in beta and its
 * tools change, so a rename here is the whole fix.
 */

const PROTOCOL_VERSION = '2025-06-18'
const CALL_TIMEOUT_MS = 60_000

export type NotionClientOptions = {
  fetchFn?: typeof fetch
  /** The run's own signal: a stopped chat or command stops the call */
  signal?: AbortSignal
}

/** Who the sign-in belongs to, as Notion names them. */
export type NotionSelf = { workspace?: string; user?: string; email?: string }

/** One page or database a search found. */
export type NotionMatch = {
  title: string
  type?: string
  url?: string
  id?: string
  /** The pages above it */
  path?: string
  /** When it was last edited, as Notion gives it */
  edited?: string
  /** The words around the match */
  highlight?: string
}

/** What a search found: the matches when Notion's answer reads as expected, else the answer as it came. */
export type NotionSearch = { matches: NotionMatch[] } | { text: string }

/** A page as read: its own text in Notion's markup, and what Notion says about it. */
export type NotionPage = { text: string; title?: string; url?: string; path?: string; edited?: string }

/** One of a table's data sources: where its rows go, and the name of its title column. */
export type NotionDataSource = { id: string; titleColumn?: string }

/** What a link or id points at: a page and its id, or a table and where its rows go. */
export type NotionTarget =
  | { kind: 'page'; id: string; title?: string }
  | { kind: 'table'; dataSources: NotionDataSource[]; title?: string }
  | { kind: 'other'; title?: string }

/** A teamspace, and whether the person is in it. */
export type NotionTeamspace = { id: string; name: string; joined: boolean }

/** Where a new page goes: under a page, as a row of a table, or at the top of a teamspace. */
export type NotionParent = { page: string } | { dataSource: string } | { teamspace: string }

/** A column's value in a row, in the forms Notion takes: text, a number, a list (people, relations), or nothing. */
export type NotionValue = string | number | string[] | null

/** A page to make: `title` outside a table, a table's own columns in one, and the body in Notion's markup. */
export type NotionNewPage = { properties: Record<string, NotionValue>; content?: string; icon?: string }

/** A page or table Notion made. */
export type NotionCreated = { url?: string }

/** A table Notion made, and where its rows go. */
export type NotionTable = NotionCreated & { dataSource?: NotionDataSource }

type Message = { jsonrpc: '2.0'; id?: number; method: string; params?: unknown }
type Reply = { id?: unknown; result?: unknown; error?: { message?: unknown } }
type ToolResult = { content?: unknown; isError?: unknown }

/** Renewals in flight, by refresh token: calls that find the token refused together renew it once. */
const renewing = new Map<string, Promise<NotionGrant>>()

export class NotionClient {
  private session: { id?: string; version: string } | null = null
  private nextId = 1

  constructor(
    private grant: NotionGrant,
    private readonly secrets: SecretsProvider,
    private readonly options: NotionClientOptions = {},
  ) {}

  /** The workspace the sign-in is for, as Notion named it then. */
  get workspace(): string | undefined {
    return this.grant.workspace
  }

  /** The workspace and person behind the sign-in. */
  async self(): Promise<NotionSelf> {
    return selfOf(await this.tool('notion-get-self', {}))
  }

  /** Pages and databases matching the words, among those the person can see. */
  async search(query: string): Promise<NotionSearch> {
    return searchOf(await this.tool('notion-search', { query }))
  }

  /** A page, database or view, by link or id: its own text, and what Notion says about it. */
  async fetch(id: string): Promise<NotionPage> {
    return pageOf(await this.tool('notion-fetch', { id }))
  }

  /** What a link or id points at, read the way a fetch reads it. */
  async target(id: string): Promise<NotionTarget> {
    return targetOf(await this.tool('notion-fetch', { id }), id)
  }

  /** The teamspaces whose names match, the person's own first; with no words, some of each. */
  async teamspaces(query?: string): Promise<NotionTeamspace[]> {
    return teamspacesOf(await this.tool('notion-get-teams', query ? { query } : {}))
  }

  /** New pages under one parent, in order; with no parent they are private pages of the person's own. */
  async createPages(pages: NotionNewPage[], parent?: NotionParent): Promise<NotionCreated[]> {
    const made = pages.map(({ properties, content, icon }) => ({
      properties,
      ...(content ? { content } : {}),
      ...(icon ? { icon } : {}),
    }))
    // Draft mode is Notion's own word for a private page, and it cannot be combined with a parent.
    const where = parent ? { parent: parentOf(parent) } : { creation_mode: 'draft' }
    return createdOf(await this.tool('notion-create-pages', { pages: made, ...where }))
  }

  /** A new table from Notion's CREATE TABLE statement, on a page or, with none, private. */
  async createTable(title: string, schema: string, page?: string): Promise<NotionTable> {
    const parent = page ? { parent: { type: 'page_id', page_id: page } } : {}
    return tableOf(await this.tool('notion-create-database', { ...parent, title, schema }))
  }

  /** Run one of Notion's tools: its text comes back joined, and the tool's own failure throws in Notion's words. */
  private async tool(name: string, args: Record<string, unknown>): Promise<string> {
    const result = (await this.request('tools/call', { name, arguments: args })) as ToolResult | undefined
    const blocks: unknown[] = Array.isArray(result?.content) ? result.content : []
    const text = blocks
      .flatMap((block) => {
        const { type, text } = (block ?? {}) as { type?: unknown; text?: unknown }
        return type === 'text' && typeof text === 'string' ? [text] : []
      })
      .join('\n\n')
    if (result?.isError === true) throw new NotionError(refusalOf(text) || `Notion could not run ${name}.`, 'tool')
    return text
  }

  private async request(method: string, params: unknown): Promise<unknown> {
    if (grantExpired(this.grant)) await this.renew()
    if (!this.session) await this.open()
    const id = this.nextId++
    const message: Message = { jsonrpc: '2.0', id, method, params }
    let response = await this.post(message)
    if (response.status === 404 && this.session?.id) {
      // Notion forgot the session: open another and ask again, once.
      await response.body?.cancel()
      this.session = null
      await this.open()
      response = await this.post(message)
    }
    return this.answer(response, id)
  }

  private async open(): Promise<void> {
    const id = this.nextId++
    const response = await this.post({
      jsonrpc: '2.0',
      id,
      method: 'initialize',
      params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'Sky', version: '1.0.0' } },
    })
    const result = (await this.answer(response, id)) as { protocolVersion?: unknown } | undefined
    const sessionId = response.headers.get('mcp-session-id')
    this.session = {
      ...(sessionId ? { id: sessionId } : {}),
      version: typeof result?.protocolVersion === 'string' ? result.protocolVersion : PROTOCOL_VERSION,
    }
    const note = await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' })
    await note.body?.cancel()
  }

  /** Post one message; a refused token is renewed once and the message posted again. */
  private async post(message: Message): Promise<Response> {
    const response = await this.send(message)
    if (response.status !== 401) return response
    await response.body?.cancel()
    await this.renew()
    return this.send(message)
  }

  private async send(message: Message): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.grant.accessToken}`,
    }
    if (this.session) {
      headers['MCP-Protocol-Version'] = this.session.version
      if (this.session.id) headers['Mcp-Session-Id'] = this.session.id
    }
    const { signal } = this.options
    const timeout = AbortSignal.timeout(CALL_TIMEOUT_MS)
    try {
      return await (this.options.fetchFn ?? fetch)(NOTION_MCP_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(message),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      })
    } catch (error) {
      if (signal?.aborted) throw error
      throw new NotionError(NOTION_UNREACHABLE, 'unavailable')
    }
  }

  /** The reply to one request: a refusal in plain words, Notion's own message when it names one. */
  private async answer(response: Response, id: number): Promise<unknown> {
    if (response.status === 401) throw new NotionError(NOTION_SIGNED_OUT, 'unauthorized', 401)
    if (!response.ok) {
      await response.body?.cancel()
      throw new NotionError(
        response.status === 429
          ? 'Notion asked Sky to slow down. Try again in a minute.'
          : `Notion answered ${response.status}. Try again in a moment.`,
        'request',
        response.status,
      )
    }
    let reply: Reply | null
    try {
      reply = (response.headers.get('content-type') ?? '').includes('text/event-stream')
        ? await replyFromStream(response, id)
        : ((await response.json()) as Reply)
    } catch (error) {
      if (this.options.signal?.aborted) throw error
      if (!(error instanceof SyntaxError)) throw new NotionError(NOTION_UNREACHABLE, 'unavailable')
      reply = null
    }
    if (!reply || typeof reply !== 'object')
      throw new NotionError('Notion sent an answer Sky could not read.', 'request')
    if (reply.error) {
      const detail = typeof reply.error.message === 'string' ? reply.error.message : 'no reason given'
      throw new NotionError(`Notion refused the request: ${detail}`, 'request')
    }
    return reply.result
  }

  /** A new access token. A disconnect wins, and another call or Sky process may have renewed it already. */
  private async renew(): Promise<void> {
    const stored = await loadNotionGrant(this.secrets)
    if (!stored) throw new NotionError(NOTION_NOT_CONNECTED, 'unauthorized')
    if (stored.accessToken !== this.grant.accessToken && !grantExpired(stored)) {
      this.grant = stored
      return
    }
    const key = stored.refreshToken ?? stored.accessToken
    let pending = renewing.get(key)
    if (!pending) {
      const { fetchFn } = this.options
      pending = refreshNotionGrant(stored, fetchFn ? { fetchFn } : {}).finally(() => renewing.delete(key))
      renewing.set(key, pending)
    }
    this.grant = await pending
    await saveNotionGrant(this.secrets, this.grant)
  }
}

/** The connected Notion, or null when nobody has signed in. */
export async function openNotion(
  secrets: SecretsProvider,
  options: NotionClientOptions = {},
): Promise<NotionClient | null> {
  const grant = await loadNotionGrant(secrets)
  return grant ? new NotionClient(grant, secrets, options) : null
}

/**
 * The reply with this id, out of an event stream. Each event's data lines
 * hold one JSON-RPC message; notes Notion sends along the way are passed over.
 */
async function replyFromStream(response: Response, id: number): Promise<Reply | null> {
  const reader = response.body?.getReader()
  if (!reader) return null
  const decoder = new TextDecoder()
  const replyIn = (event: string): Reply | null => {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
      .join('\n')
    if (!data) return null
    try {
      const message = JSON.parse(data) as Reply | null
      return message && typeof message === 'object' && message.id === id ? message : null
    } catch {
      return null
    }
  }
  let buffer = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      const events = buffer.split(/\r?\n\r?\n/)
      buffer = done ? '' : (events.pop() ?? '')
      for (const event of events) {
        const reply = replyIn(event)
        if (reply) return reply
      }
      if (done) return null
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
}

const record = (value: unknown) =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : ({} as Record<string, unknown>)

const named = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined)

/** Notion's links carry a tracking parameter; the page is the same without it. */
export function cleanLink(url: string): string {
  try {
    const link = new URL(url)
    link.searchParams.delete('pvs')
    return link.toString()
  } catch {
    return url
  }
}

/** The matches in notion-search's answer: JSON with a results list. Another shape is handed on as it came. */
export function searchOf(text: string): NotionSearch {
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return { text }
  }
  const results = record(body).results
  if (!Array.isArray(results)) return { text }
  const matches = results.flatMap((item): NotionMatch[] => {
    const result = record(item)
    const title = named(result.title)
    if (!title) return []
    const url = named(result.url)
    const fields = {
      type: named(result.type),
      url: url ? cleanLink(url) : undefined,
      id: named(result.id),
      path: named(result.path),
      edited: named(result.timestamp),
      highlight: named(result.highlight),
    }
    return [{ title, ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value)) }]
  })
  return { matches }
}

/** A page out of notion-fetch's answer: JSON whose `text` is the page itself. Another shape is the page as it came. */
export function pageOf(text: string): NotionPage {
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return { text }
  }
  const page = record(body)
  if (typeof page.text !== 'string') return { text }
  const title = named(page.title)
  const url = named(page.url)
  const path = named(page.path)
  const edited = named(page.page_last_edited_at)
  return {
    text: page.text,
    ...(title ? { title } : {}),
    ...(url ? { url: cleanLink(url) } : {}),
    ...(path ? { path } : {}),
    ...(edited ? { edited } : {}),
  }
}

/** Notion's reason out of a tool's failure: the message of the JSON error it often sends, else the text as it came. */
function refusalOf(text: string): string {
  try {
    return named(record(JSON.parse(text)).message) ?? text
  } catch {
    return text
  }
}

const NOTION_ID =
  /(?<![0-9a-f])([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?![0-9a-f])/gi

/** The page id in a Notion link or id, without dashes: the last one in the path, past any title words. */
export function notionId(text: string): string | undefined {
  const path = text.split(/[?#]/)[0] ?? ''
  return [...path.matchAll(NOTION_ID)].at(-1)?.[1]?.replace(/-/g, '').toLowerCase()
}

function parentOf(parent: NotionParent): Record<string, string> {
  if ('page' in parent) return { type: 'page_id', page_id: parent.page }
  if ('dataSource' in parent) return { type: 'data_source_id', data_source_id: parent.dataSource }
  return { teamspace_id: parent.teamspace }
}

/**
 * A table's data sources out of Notion's markup: each `<data-source>` tag
 * names its collection, and the JSON state inside it says which column is
 * the title.
 */
function dataSourcesIn(text: string): NotionDataSource[] {
  return text
    .split('<data-source url="')
    .slice(1)
    .flatMap((block): NotionDataSource[] => {
      const id = /^\{*collection:\/\/([^}"]+)\}*"/.exec(block)?.[1]
      if (!id) return []
      const state = /<data-source-state>([\s\S]*?)<\/data-source-state>/.exec(block)?.[1]
      let titleColumn: string | undefined
      try {
        const columns = Object.values(record(record(JSON.parse(state ?? '')).schema)).map(record)
        titleColumn = named(columns.find((column) => column.type === 'title')?.name)
      } catch {
        // No state to read: the rows still go to this source, and the title column is guessed later.
      }
      return [{ id, ...(titleColumn ? { titleColumn } : {}) }]
    })
}

/** What notion-fetch's answer is about: a page and its id, a table and its data sources, or something else. */
export function targetOf(text: string, asked: string): NotionTarget {
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return { kind: 'other' }
  }
  const answer = record(body)
  const type = named(record(answer.metadata).type)
  const title = named(answer.title)
  const label = title ? { title } : {}
  if (type === 'page') {
    const id = notionId(named(answer.url) ?? '') ?? notionId(asked)
    if (id) return { kind: 'page', id, ...label }
  }
  if (type === 'database' || type === 'data_source')
    return { kind: 'table', dataSources: dataSourcesIn(typeof answer.text === 'string' ? answer.text : ''), ...label }
  return { kind: 'other', ...label }
}

/** The teamspaces in notion-get-teams' answer, the person's own first; ones in the trash are left out. */
export function teamspacesOf(text: string): NotionTeamspace[] {
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return []
  }
  const answer = record(body)
  const listed = (teams: unknown, joined: boolean) =>
    (Array.isArray(teams) ? teams : []).flatMap((item): NotionTeamspace[] => {
      const team = record(item)
      const id = named(team.id)
      const name = named(team.name)
      return id && name && team.in_trash !== true ? [{ id, name, joined }] : []
    })
  return [...listed(answer.joinedTeams, true), ...listed(answer.otherTeams, false)]
}

/** The pages notion-create-pages made, in order: JSON with a pages list. */
export function createdOf(text: string): NotionCreated[] {
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return []
  }
  const pages = record(body).pages
  return (Array.isArray(pages) ? pages : []).map((item) => {
    const url = named(record(item).url)
    return url ? { url: cleanLink(url) } : {}
  })
}

/** The table notion-create-database made: its link out of the `<database>` tag, and where its rows go. */
export function tableOf(text: string): NotionTable {
  let markup = text
  try {
    const result = record(JSON.parse(text)).result
    if (typeof result === 'string') markup = result
  } catch {
    // Markup as it came.
  }
  const url = /<database url="\{*(https?:\/\/[^"}]+)\}*"/.exec(markup)?.[1]
  const [dataSource] = dataSourcesIn(markup)
  return { ...(url ? { url: cleanLink(url) } : {}), ...(dataSource ? { dataSource } : {}) }
}

/** The names in notion-get-self's answer, read leniently: JSON with a workspace and a user. */
export function selfOf(text: string): NotionSelf {
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return {}
  }
  const top = record(body)
  const user = record(top.user)
  const workspace = named(record(top.workspace).name)
  const userName = named(user.name)
  const email = named(user.email)
  return {
    ...(workspace ? { workspace } : {}),
    ...(userName ? { user: userName } : {}),
    ...(email ? { email } : {}),
  }
}
