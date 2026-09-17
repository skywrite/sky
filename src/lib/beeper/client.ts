import { z } from 'zod'

/**
 * Beeper Desktop's local API, over plain fetch. Every call needs the desktop
 * app running on this Mac; nothing here reaches the network. Only the fields
 * Sky reads are modelled; Beeper's other fields pass through unread.
 */

export const BEEPER_BASE_URL = 'http://127.0.0.1:23373'

export const BEEPER_NOT_RUNNING = 'Beeper Desktop is not running on this Mac.'

export type BeeperFailure = 'unavailable' | 'unauthorized' | 'request'

export class BeeperError extends Error {
  constructor(
    message: string,
    readonly kind: BeeperFailure,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'BeeperError'
  }
}

/** Beeper writes an absent field as null as readily as it leaves it out. */
const maybe = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === null ? undefined : value), schema.optional())
const text = (fallback = '') => maybe(z.string()).transform((value) => value ?? fallback)

export const BeeperUserSchema = z.object({
  id: z.string(),
  username: maybe(z.string()),
  phoneNumber: maybe(z.string()),
  email: maybe(z.string()),
  fullName: maybe(z.string()),
  isSelf: maybe(z.boolean()),
})
export type BeeperUser = z.infer<typeof BeeperUserSchema>

export const BeeperAccountSchema = z.object({
  accountID: z.string(),
  network: maybe(z.string()),
  status: maybe(z.string()),
  statusText: maybe(z.string()),
  user: maybe(BeeperUserSchema),
  bridge: maybe(z.object({ id: text(), type: text(), provider: maybe(z.string()) })),
})
export type BeeperAccount = z.infer<typeof BeeperAccountSchema>

export const BeeperChatSchema = z.object({
  id: z.string(),
  accountID: z.string(),
  network: text(),
  title: text(),
  type: z.enum(['single', 'group']).catch('single'),
  participants: maybe(
    z.object({
      items: maybe(z.array(BeeperUserSchema)).transform((value) => value ?? []),
      hasMore: maybe(z.boolean()),
      total: maybe(z.number()),
    }),
  ),
  unreadCount: maybe(z.number()),
  lastActivity: maybe(z.string()),
  isArchived: maybe(z.boolean()),
  isMuted: maybe(z.boolean()),
  isLowPriority: maybe(z.boolean()),
  isReadOnly: maybe(z.boolean()),
  draft: maybe(z.object({ text: text() })),
})
export type BeeperChat = z.infer<typeof BeeperChatSchema>

export const BeeperAttachmentSchema = z.object({
  id: maybe(z.string()),
  type: text('unknown'),
  srcURL: maybe(z.string()),
  mimeType: maybe(z.string()),
  fileName: maybe(z.string()),
  fileSize: maybe(z.number()),
  isGif: maybe(z.boolean()),
  isSticker: maybe(z.boolean()),
  isVoiceNote: maybe(z.boolean()),
  duration: maybe(z.number()),
  transcription: maybe(z.object({ transcription: maybe(z.string()) })),
})
export type BeeperAttachment = z.infer<typeof BeeperAttachmentSchema>

export const BeeperMessageSchema = z.object({
  id: z.string(),
  chatID: z.string(),
  accountID: z.string(),
  senderID: z.string(),
  senderName: maybe(z.string()),
  timestamp: z.string(),
  sortKey: z.string(),
  type: maybe(z.string()),
  text: maybe(z.string()),
  isSender: maybe(z.boolean()),
  isDeleted: maybe(z.boolean()),
  isHidden: maybe(z.boolean()),
  attachments: maybe(z.array(BeeperAttachmentSchema)),
  linkedMessageID: maybe(z.string()),
})
export type BeeperMessage = z.infer<typeof BeeperMessageSchema>

const page = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: maybe(z.array(item)).transform((value) => value ?? []),
    hasMore: maybe(z.boolean()).transform((value) => value ?? false),
    oldestCursor: maybe(z.string()),
    newestCursor: maybe(z.string()),
  })
export const BeeperChatPageSchema = page(BeeperChatSchema)
export const BeeperMessagePageSchema = page(BeeperMessageSchema)
export type BeeperPage<T> = { items: T[]; hasMore: boolean; oldestCursor?: string; newestCursor?: string }

export const BeeperInfoSchema = z.object({
  app: maybe(z.object({ version: maybe(z.string()) })),
  server: maybe(
    z.object({ status: maybe(z.string()), mcp_enabled: maybe(z.boolean()), remote_access: maybe(z.boolean()) }),
  ),
})
export type BeeperInfo = z.infer<typeof BeeperInfoSchema>

export const BeeperTokenInfoSchema = z.object({
  scope: text(),
  exp: maybe(z.number()),
  client_id: maybe(z.string()),
})

export type BeeperQuery = Record<string, string | number | boolean | string[] | undefined>

export type BeeperClientOptions = { baseUrl?: string; fetchFn?: typeof fetch }

export type ChatSearch = {
  inbox?: 'primary' | 'low-priority' | 'archive'
  includeMuted?: boolean
  unreadOnly?: boolean
  type?: 'single' | 'group' | 'any'
  lastActivityAfter?: string
  lastActivityBefore?: string
  accountIDs?: string[]
  limit?: number
  cursor?: string
  direction?: 'before' | 'after'
}

/** Whether Beeper Desktop answers on this Mac, without a token. */
export async function beeperInfo(options: BeeperClientOptions = {}): Promise<BeeperInfo | null> {
  try {
    const response = await (options.fetchFn ?? fetch)(new URL('/v1/info', options.baseUrl ?? BEEPER_BASE_URL))
    if (!response.ok) return null
    const parsed = BeeperInfoSchema.safeParse(await response.json())
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export class BeeperClient {
  constructor(
    private readonly token: string,
    private readonly options: BeeperClientOptions = {},
  ) {}

  get baseUrl(): string {
    return this.options.baseUrl ?? BEEPER_BASE_URL
  }

  /** The token's grant, as Beeper sees it. Unauthorized when the token is gone. */
  tokenInfo() {
    return this.request(BeeperTokenInfoSchema, 'GET', '/oauth/userinfo')
  }

  accounts(): Promise<BeeperAccount[]> {
    return this.request(z.array(BeeperAccountSchema), 'GET', '/v1/accounts')
  }

  searchChats(params: ChatSearch = {}): Promise<BeeperPage<BeeperChat>> {
    return this.request(BeeperChatPageSchema, 'GET', '/v1/chats/search', { query: params })
  }

  chat(chatID: string): Promise<BeeperChat> {
    return this.request(BeeperChatSchema, 'GET', `/v1/chats/${encodeURIComponent(chatID)}`)
  }

  messages(chatID: string, params: { cursor?: string; direction?: 'before' | 'after' } = {}) {
    return this.request(BeeperMessagePageSchema, 'GET', `/v1/chats/${encodeURIComponent(chatID)}/messages`, {
      query: params,
    })
  }

  /** Beeper accepts a new draft only into an empty composer; an empty text clears it. */
  setDraft(chatID: string, text: string): Promise<BeeperChat> {
    return this.request(BeeperChatSchema, 'PATCH', `/v1/chats/${encodeURIComponent(chatID)}`, {
      json: { draft: { text } },
    })
  }

  /** Bring Beeper Desktop to the front, on a chat when one is named. */
  focus(params: { chatID?: string; messageID?: string; draftText?: string } = {}): Promise<{ success: boolean }> {
    return this.request(z.object({ success: z.boolean().default(true) }), 'POST', '/v1/focus', { json: params })
  }

  /** Beeper copies the media to a local file and answers with its path. */
  downloadAsset(url: string): Promise<{ srcURL?: string; error?: string }> {
    return this.request(
      z.object({ srcURL: maybe(z.string()), error: maybe(z.string()) }),
      'POST',
      '/v1/assets/download',
      { json: { url } },
    )
  }

  private async request<T>(
    schema: z.ZodType<T>,
    method: string,
    route: string,
    options: { query?: BeeperQuery; json?: unknown } = {},
  ): Promise<T> {
    const url = new URL(route, this.baseUrl)
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value === undefined) continue
      for (const one of Array.isArray(value) ? value : [value]) url.searchParams.append(key, String(one))
    }
    let response: Response
    try {
      response = await (this.options.fetchFn ?? fetch)(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/json',
          ...(options.json === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(options.json === undefined ? {} : { body: JSON.stringify(options.json) }),
      })
    } catch {
      throw new BeeperError(BEEPER_NOT_RUNNING, 'unavailable')
    }
    const text = await response.text()
    let body: unknown
    try {
      body = text ? JSON.parse(text) : undefined
    } catch {
      body = undefined
    }
    if (response.status === 401)
      throw new BeeperError(
        'Beeper no longer accepts Sky’s connection. Reconnect Beeper in Settings.',
        'unauthorized',
        401,
      )
    if (!response.ok) {
      const message =
        body && typeof body === 'object' && typeof (body as { message?: unknown }).message === 'string'
          ? (body as { message: string }).message
          : `Beeper answered ${response.status}.`
      throw new BeeperError(message, 'request', response.status)
    }
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      const where = issue ? ` (${issue.path.join('.') || 'body'}: ${issue.message})` : ''
      throw new BeeperError(`Beeper answered in a shape Sky does not understand${where}.`, 'request', 200)
    }
    return parsed.data
  }
}
