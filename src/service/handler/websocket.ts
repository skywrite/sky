/**
 * Cross-runtime WebSocket handler for GraphQL subscriptions.
 *
 * Uses the `ws` library (npm:ws) with node:http upgrade events.
 * Works on Deno, Bun, and Node.js.
 */

import { type WebSocket, WebSocketServer } from 'ws'
import { Buffer } from 'node:buffer'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { Store } from '../store.ts'

/**
 * Create a WebSocket server for GraphQL subscriptions.
 *
 * Attach to a node:http server's 'upgrade' event:
 * ```
 * server.on('upgrade', wsHandler.handleUpgrade)
 * ```
 */
export function createWebSocketHandler(store: Store) {
  const wss = new WebSocketServer({
    noServer: true,
    handleProtocols: (protocols: Set<string>) =>
      protocols.has('graphql-transport-ws') ? 'graphql-transport-ws' : false,
  })

  function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    if (req.url !== '/graphql') return

    wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      console.log('WebSocket client connected')
      const listeners: Array<{ event: string; fn: (...args: any[]) => void }> = []

      ws.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString())

          if (message.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong' }))
            return
          }

          console.log('WebSocket message:', message)

          if (message.type === 'connection_init') {
            ws.send(JSON.stringify({ type: 'connection_ack' }))
          } else if (message.type === 'subscribe') {
            const { id, payload } = message
            if (id && payload?.query) {
              setupSubscription(ws, store, id, payload.query, listeners)
            }
          }
        } catch (error) {
          console.error('WebSocket message error:', error)
        }
      })

      ws.on('close', () => {
        console.log('WebSocket client disconnected')
        for (const { event, fn } of listeners) {
          store.off(event, fn)
        }
        listeners.length = 0
      })

      ws.on('error', (error: Error) => {
        console.error('WebSocket error:', error)
      })
    })
  }

  return { handleUpgrade }
}

/**
 * Set up a subscription based on the GraphQL query.
 */
function setupSubscription(
  ws: WebSocket,
  store: Store,
  id: string,
  query: string,
  listeners: Array<{ event: string; fn: (...args: any[]) => void }>,
): void {
  let event: string | undefined
  let fn: ((...args: any[]) => void) | undefined

  if (query.includes('tagsUpdated')) {
    event = 'tagsUpdated'
    fn = (tags: Iterable<string>) => {
      ws.send(
        JSON.stringify({
          id,
          type: 'next',
          payload: { data: { tagsUpdated: Array.from(tags).toSorted() } },
        }),
      )
    }
  } else if (query.includes('peopleUpdated')) {
    event = 'peopleUpdated'
    fn = (people: Iterable<string>) => {
      ws.send(
        JSON.stringify({
          id,
          type: 'next',
          payload: { data: { peopleUpdated: Array.from(people).toSorted() } },
        }),
      )
    }
  } else if (query.includes('organizationsUpdated')) {
    event = 'organizationsUpdated'
    fn = (orgs: Iterable<string>) => {
      ws.send(
        JSON.stringify({
          id,
          type: 'next',
          payload: { data: { organizationsUpdated: Array.from(orgs).toSorted() } },
        }),
      )
    }
  } else if (query.includes('peopleWithScoresUpdated')) {
    event = 'personScoresUpdated'
    fn = (scores: unknown) => {
      ws.send(
        JSON.stringify({
          id,
          type: 'next',
          payload: { data: { peopleWithScoresUpdated: scores } },
        }),
      )
    }
  } else if (query.includes('organizationsWithScoresUpdated')) {
    event = 'orgScoresUpdated'
    fn = (scores: unknown) => {
      ws.send(
        JSON.stringify({
          id,
          type: 'next',
          payload: { data: { organizationsWithScoresUpdated: scores } },
        }),
      )
    }
  } else if (query.includes('tagsWithScoresUpdated')) {
    event = 'tagScoresUpdated'
    fn = (scores: unknown) => {
      ws.send(
        JSON.stringify({
          id,
          type: 'next',
          payload: { data: { tagsWithScoresUpdated: scores } },
        }),
      )
    }
  }

  if (event && fn) {
    store.on(event, fn)
    listeners.push({ event, fn })
    return
  }

  // No branch matched. Registering nothing here is indistinguishable, from the
  // client's side, from a subscription that simply has no updates yet — so an
  // unhandled field goes unnoticed until someone wonders why their data is
  // stale. `tagsWithScoresUpdated` sat in exactly that state, silently feeding
  // nothing to the editor's tag completions. Fail loudly instead.
  console.error(`WebSocket: no handler for subscription id=${id}: ${query}`)
  ws.send(
    JSON.stringify({
      id,
      type: 'error',
      payload: [{ message: `Unsupported subscription: ${query}` }],
    }),
  )
}
