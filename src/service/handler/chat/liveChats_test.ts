import { rm } from 'node:fs/promises'
import type { LiveChatAccess } from '#commands/lib/chat/liveChats.ts'
import { findLiveChats, readLiveChat } from '#commands/lib/chat/liveChats.ts'
import { makeTempDir } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import { createChatRoutes } from './mod.ts'
import { replyThreadTestHost } from './replyThreadsTestHelpers.ts'

test('other chat access follows live messages, restoration and discard without exposing the requesting chat', async () => {
  const root = await makeTempDir({ prefix: 'sky-live-chats-' })
  const access = new Map<string, LiveChatAccess>()
  let hold = false
  let started!: () => void
  let finish!: () => void
  const working = new Promise<void>((resolve) => {
    started = resolve
  })
  const release = new Promise<void>((resolve) => {
    finish = resolve
  })
  const host = replyThreadTestHost(root, {
    wait: async ({ id }) => {
      if (id === 'source' && hold) {
        started()
        await release
      }
    },
  })
  const createSession = host.createSession
  host.createSession = (...args) => {
    access.set(args[0], args[7]!)
    return createSession(...args)
  }
  let app = createChatRoutes(host)
  const send = async (id: string, message: string) => {
    const response = await app.request(`/${id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, profile: 'test-thread-model', contextTokens: 0, saves: false }),
    })
    const body = await response.text()
    if (!response.ok || !body.includes('event: turn')) throw new Error(body)
  }
  try {
    await send('source', 'Atlas positioning: simplify sample imports.')
    await send('target', 'Write a launch brief.')
    const read = () => readLiveChat(access.get('target')!, 'source', {})
    const first = read()
    hold = true
    const pending = send('source', 'Add a guided import preview.')
    await working
    const busy = read()
    finish()
    await pending
    const latest = read()
    app = createChatRoutes(host)
    await app.request('/target')
    const restored = read()
    const closed = await app.request('/source/end', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ save: false }),
    })
    await closed.text()
    assert({
      given: 'a target reads another open chat while it changes, then after restart and discard',
      should: 'see current recorded messages and busy status, restore access, and stop returning a discarded source',
      actual: {
        initial: first.success && first.text.includes('simplify sample imports'),
        busy: busy.success && busy.busy && busy.text.includes('guided import preview'),
        completed: latest.success && !latest.busy && latest.version !== (busy.success && busy.version),
        restored: restored.success && latest.success && restored.text === latest.text,
        discarded: read().success,
        self: readLiveChat(access.get('target')!, 'target', {}).success,
        remaining: findLiveChats(access.get('target')!, {}).total,
      },
      expected: {
        initial: true,
        busy: true,
        completed: true,
        restored: true,
        discarded: false,
        self: false,
        remaining: 0,
      },
    })
  } finally {
    finish()
    await rm(root, { recursive: true, force: true })
  }
})
