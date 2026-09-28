import { describe, expect, test } from 'bun:test'
import { createExtensionRoutes, type ExtensionRoutesOptions } from './routes.ts'

function host(
  overrides: Partial<ExtensionRoutesOptions> = {},
): ExtensionRoutesOptions & { calls: Array<[string, unknown]> } {
  const calls: Array<[string, unknown]> = []
  return {
    calls,
    list: async () => [
      {
        id: 'jane-doe/atlas',
        author: 'jane-doe',
        slug: 'atlas',
        name: 'Atlas',
        version: '0.1.0',
        description: 'd',
        categories: ['CRM'],
        authorName: 'Jane Doe',
        from: '/x',
        enabled: true,
        ui: true,
      },
    ],
    run: async (command, args) => {
      calls.push([command, args])
      return command.startsWith('atlas:') ? { status: 'success', data: { ok: 1 }, log: ['hello'] } : null
    },
    enable: async (id) => (id === 'jane-doe/atlas' ? { ok: true } : { ok: false, reason: `${id} is not installed` }),
    reload: async () => {},
    ...overrides,
  }
}

const post = (app: ReturnType<typeof createExtensionRoutes>, body: unknown) =>
  app.request('/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

describe('extension routes', () => {
  test('lists installed extensions', async () => {
    const res = await createExtensionRoutes(host()).request('/list')
    expect(res.status).toBe(200)
    expect(((await res.json()) as { extensions: Array<{ id: string }> }).extensions[0].id).toBe('jane-doe/atlas')
  })

  test('runs an extension command with its args', async () => {
    const h = host()
    const res = await post(createExtensionRoutes(h), {
      command: 'atlas:contact:show',
      args: { person: 'people/Jane.md' },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'success', data: { ok: 1 }, log: ['hello'] })
    expect(h.calls).toEqual([['atlas:contact:show', { person: 'people/Jane.md' }]])
  })

  test('a command no extension owns is a 404', async () => {
    const res = await post(createExtensionRoutes(host()), { command: 'day:start' })
    expect(res.status).toBe(404)
  })

  test('a malformed name never reaches the host', async () => {
    const h = host()
    for (const command of ['', 'atlas', '../x:y', 'Atlas:Show', 42]) {
      expect((await post(createExtensionRoutes(h), { command })).status).toBe(400)
    }
    expect(h.calls).toEqual([])
  })

  test('switching on and off takes an id and a boolean, and names an unknown extension', async () => {
    const app = createExtensionRoutes(host())
    const post = (body: unknown) =>
      app.request('/enable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    expect((await post({ id: 'jane-doe/atlas', enabled: false })).status).toBe(200)
    expect((await post({ id: 'jane-doe/nope', enabled: true })).status).toBe(404)
    expect((await post({ id: 'atlas', enabled: true })).status).toBe(400)
    expect((await post({ id: 'jane-doe/atlas', enabled: 'yes' })).status).toBe(400)
  })

  test('reload answers', async () => {
    const res = await createExtensionRoutes(host()).request('/reload', { method: 'POST' })
    expect(await res.json()).toEqual({ reloaded: true })
  })

  test('args that are not an object become none', async () => {
    const h = host()
    await post(createExtensionRoutes(h), { command: 'atlas:x', args: ['a'] })
    expect(h.calls).toEqual([['atlas:x', {}]])
  })
})
