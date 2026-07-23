/**
 * Centralized data store for completion providers.
 * Fetches tags, people, and organizations from GraphQL and caches them in memory.
 * Uses WebSocket subscriptions for real-time updates.
 *
 * IMPORTANT — Reconnection must rehydrate all data:
 * When the server restarts (or is dead for a while), new data can be added
 * (e.g. new orgs, people, tags) that this client will never hear about via
 * WebSocket subscription — subscriptions only push *changes after connect*.
 * On every reconnect, fetchAll() MUST be called to fully rehydrate the store.
 * Without this, the client sits on stale data until the next VSCode reload.
 * This bug was introduced in Oct 2025 and not caught until Mar 2026.
 */

import WebSocket from 'ws'

const GRAPHQL_URL = 'http://localhost:9999/graphql'
const GRAPHQL_WS_URL = 'ws://localhost:9999/graphql'

export interface PersonWithScore {
  name: string
  score: number
}

export interface TagWithScore {
  name: string
  score: number
}

interface GraphQLResponse {
  data: {
    tags: string[]
    peopleNames: string[]
    organizations: string[]
    peopleWithScores: PersonWithScore[]
    tagsWithScores: TagWithScore[]
  }
}

export class CompletionDataStore {
  private static instance: CompletionDataStore | null = null

  private tags: string[] = []
  private tagsWithScores_: TagWithScore[] = []
  private people: string[] = []
  private peopleWithScores: PersonWithScore[] = []
  private organizations: string[] = []
  private ws: WebSocket | null = null
  private isInitialized = false
  private reconnectAttempts = 0
  private reconnectTimeout: NodeJS.Timeout | null = null
  private pingInterval: NodeJS.Timeout | null = null
  private waitingForPong = false
  private maxReconnectDelay = 30000 // Max 30 seconds between reconnect attempts
  private isDisposed = false

  private constructor() {}

  static getInstance(): CompletionDataStore {
    if (!CompletionDataStore.instance) {
      CompletionDataStore.instance = new CompletionDataStore()
    }
    return CompletionDataStore.instance
  }

  /**
   * Initialize the store with initial fetch and WebSocket subscriptions.
   * Should be called once during extension activation.
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return
    }

    // Initial fetch
    await this.fetchAll()

    // Set up WebSocket subscriptions for real-time updates
    this.setupSubscriptions()

    this.isInitialized = true
  }

  /**
   * Dispose of the store and close WebSocket connections.
   * Should be called during extension deactivation.
   */
  dispose(): void {
    this.isDisposed = true

    if (this.pingInterval) {
      clearInterval(this.pingInterval)
      this.pingInterval = null
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }

    if (this.ws) {
      this.ws.close()
      this.ws = null
    }

    this.isInitialized = false
  }

  /**
   * Fetch all completion data from GraphQL in a single query.
   */
  private async fetchAll(): Promise<void> {
    try {
      const query = `
        query {
          tags
          peopleNames
          organizations
          peopleWithScores {
            name
            score
          }
          tagsWithScores {
            name
            score
          }
        }
      `

      const response = await fetch(GRAPHQL_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
      })

      if (!response.ok) {
        throw new Error(`GraphQL request failed: ${response.statusText}`)
      }

      const result: GraphQLResponse = await response.json()

      this.tags = result.data.tags || []
      this.tagsWithScores_ = result.data.tagsWithScores || []
      this.people = result.data.peopleNames || []
      this.organizations = result.data.organizations || []
      this.peopleWithScores = result.data.peopleWithScores || []
    } catch (error) {
      // Keep existing data on error rather than clearing it
      console.error('[CompletionDataStore] Error fetching data:', error)
    }
  }

  /**
   * Set up WebSocket subscriptions for real-time updates using graphql-ws protocol.
   */
  private setupSubscriptions(): void {
    try {
      this.ws = new WebSocket(GRAPHQL_WS_URL, 'graphql-transport-ws')

      this.ws.on('open', () => {
        console.log('[CompletionDataStore] WebSocket connected')
        const isReconnect = this.reconnectAttempts > 0
        this.reconnectAttempts = 0
        this.ws!.send(JSON.stringify({ type: 'connection_init' }))

        // Re-fetch all data on reconnect — the server may have restarted
        // with new data that won't arrive via WebSocket subscription
        if (isReconnect) {
          this.fetchAll()
        }
      })

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString())

          switch (message.type) {
            case 'connection_ack':
              this.subscribe('tags', 'tagsUpdated')
              this.subscribe('people', 'peopleUpdated')
              this.subscribe('organizations', 'organizationsUpdated')
              this.subscribe('peopleWithScores', 'peopleWithScoresUpdated { name score }')
              this.subscribe('tagsWithScores', 'tagsWithScoresUpdated { name score }')
              this.startPingInterval()
              break

            case 'pong':
              this.waitingForPong = false
              break

            case 'next':
              this.handleSubscriptionData(message)
              break

            case 'error':
              console.error('[CompletionDataStore] Subscription error:', message.payload)
              break
          }
        } catch (error) {
          console.error('[CompletionDataStore] Error parsing WebSocket message:', error)
        }
      })

      this.ws.on('error', (error: Error) => {
        console.error('[CompletionDataStore] WebSocket error:', error)
      })

      this.ws.on('close', () => {
        console.log('[CompletionDataStore] WebSocket closed, reconnecting...')
        this.stopPingInterval()
        this.ws = null
        this.scheduleReconnect()
      })
    } catch (error) {
      console.error('[CompletionDataStore] Error setting up subscriptions:', error)
      this.scheduleReconnect()
    }
  }

  /**
   * Subscribe to a specific subscription.
   */
  private subscribe(id: string, fieldName: string): void {
    if (!this.ws) return

    const message = {
      id,
      type: 'subscribe',
      payload: {
        query: `subscription { ${fieldName} }`,
      },
    }

    this.ws.send(JSON.stringify(message))
  }

  /**
   * Handle subscription data updates.
   */
  private handleSubscriptionData(message: any): void {
    const { id, payload } = message

    if (!payload || !payload.data) {
      return
    }

    switch (id) {
      case 'tags':
        if (payload.data.tagsUpdated) {
          this.tags = payload.data.tagsUpdated
          console.log('[CompletionDataStore] Tags updated:', this.tags.length)
        }
        break

      case 'people':
        if (payload.data.peopleUpdated) {
          this.people = payload.data.peopleUpdated
          console.log('[CompletionDataStore] People updated:', this.people.length)
        }
        break

      case 'organizations':
        if (payload.data.organizationsUpdated) {
          this.organizations = payload.data.organizationsUpdated
          console.log('[CompletionDataStore] Organizations updated:', this.organizations.length)
        }
        break

      case 'peopleWithScores':
        if (payload.data.peopleWithScoresUpdated) {
          this.peopleWithScores = payload.data.peopleWithScoresUpdated
          console.log('[CompletionDataStore] People with scores updated:', this.peopleWithScores.length)
        }
        break

      case 'tagsWithScores':
        if (payload.data.tagsWithScoresUpdated) {
          this.tagsWithScores_ = payload.data.tagsWithScoresUpdated
          console.log('[CompletionDataStore] Tags with scores updated:', this.tagsWithScores_.length)
        }
        break
    }
  }

  /**
   * Get all tags.
   */
  getTags(): string[] {
    return this.tags
  }

  /**
   * Get all tags with their scores, sorted by score (descending).
   */
  getTagsWithScores(): TagWithScore[] {
    return this.tagsWithScores_
  }

  /**
   * Get all people.
   */
  getPeople(): string[] {
    return this.people
  }

  /**
   * Get all people with their scores, sorted by score (descending).
   */
  getPeopleWithScores(): PersonWithScore[] {
    return this.peopleWithScores
  }

  /**
   * Get score for a specific person.
   */
  getPersonScore(name: string): number {
    const person = this.peopleWithScores.find((p) => p.name === name)
    return person?.score ?? 0
  }

  /**
   * Get all organizations.
   */
  getOrganizations(): string[] {
    return this.organizations
  }

  /**
   * Get the initialization status.
   */
  isReady(): boolean {
    return this.isInitialized
  }

  private startPingInterval(): void {
    this.stopPingInterval()
    this.waitingForPong = false

    this.pingInterval = setInterval(() => {
      if (this.waitingForPong) {
        console.log('[CompletionDataStore] Missed pong, closing connection')
        this.ws?.close()
        return
      }

      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.waitingForPong = true
        this.ws.send(JSON.stringify({ type: 'ping' }))
      }
    }, 15_000)
  }

  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval)
      this.pingInterval = null
    }
    this.waitingForPong = false
  }

  /**
   * Schedule a reconnection attempt with exponential backoff.
   */
  private scheduleReconnect(): void {
    // Don't reconnect if disposed
    if (this.isDisposed) {
      return
    }

    // Clear any existing reconnect timeout
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
    }

    // Calculate delay with exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (max)
    const baseDelay = 1000
    const delay = Math.min(
      baseDelay * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectDelay
    )

    this.reconnectAttempts++
    console.log(`[CompletionDataStore] Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts})`)

    this.reconnectTimeout = setTimeout(() => {
      this.setupSubscriptions()
    }, delay)
  }
}
