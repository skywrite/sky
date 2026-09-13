import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { runWithUsageSource } from '#shared/ai/usageLog.ts'

export const AboutMeInputSchema = z.object({
  name: z.string().trim().max(200),
  text: z.string().max(80_000),
  links: z
    .array(
      z
        .string()
        .trim()
        .max(2048)
        .url()
        .refine((value) => {
          const url = new URL(value)
          return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
        }, 'Use a website link beginning with https://.'),
    )
    .max(8),
})

export type AboutMeInput = z.infer<typeof AboutMeInputSchema>
export interface AboutMeProfile extends AboutMeInput {
  revision: string
}
export interface AboutMeSource {
  url: string
  text?: string
  error?: string
}
export interface AboutMeSuggestion {
  name: string
  text: string
  questions: string[]
  sources: AboutMeSource[]
}
export interface AboutMeHost {
  read: () => Promise<AboutMeProfile>
  save: (input: AboutMeProfile) => Promise<AboutMeProfile>
  learn: (input: AboutMeInput) => Promise<AboutMeSuggestion>
}

export class AboutMeError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 409 | 422 | 502 = 400,
  ) {
    super(message)
  }
}

export function createAboutMeRoutes(host: AboutMeHost): Hono {
  const app = new Hono()
  app.use('*', bodyLimit({ maxSize: 384 * 1024 }))
  app.use('*', async (c, next) => {
    const origin = c.req.header('Origin')
    if (
      c.req.method !== 'GET' &&
      ((origin && origin !== new URL(c.req.url).origin) || c.req.header('Sec-Fetch-Site') === 'cross-site')
    )
      return c.json({ message: 'Open Sky directly to update your profile.' }, 403)
    await next()
  })
  app.onError((error, c) =>
    c.json(
      {
        message:
          error instanceof z.ZodError
            ? 'Check your profile and links. Use full website URLs, with up to eight links.'
            : error instanceof SyntaxError
              ? 'The profile could not be read. Try saving again.'
              : error.message,
      },
      error instanceof AboutMeError
        ? error.status
        : error instanceof z.ZodError || error instanceof SyntaxError
          ? 400
          : 500,
    ),
  )
  app.get('/', async (c) => c.json(await host.read()))
  app.put('/', async (c) => {
    const input = AboutMeInputSchema.extend({ revision: z.string() }).parse(await c.req.json())
    return c.json(await host.save(input))
  })
  app.post('/learn', async (c) => {
    const input = AboutMeInputSchema.parse(await c.req.json())
    if (!input.links.length) return c.json({ message: 'Add a link for Sky to read first.' }, 400)
    return c.json(await runWithUsageSource('me:about:learn', () => host.learn(input)))
  })
  return app
}
