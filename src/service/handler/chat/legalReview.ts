import { readFile } from 'node:fs/promises'
import type { Hono } from 'hono'
import type { LegalReviewStore } from '#lib/legalReview/store.ts'

export function registerLegalReviewRoutes(
  app: Hono,
  store: LegalReviewStore,
  linked: (id: string) => Promise<{ reviewId?: string } | null>,
): void {
  app.get('/:id/legal-review', async (c) => {
    const chat = await linked(c.req.param('id'))
    if (!chat) return c.json({ message: 'No such conversation.' }, 404)
    try {
      const review = chat.reviewId ? await store.read(chat.reviewId) : null
      if (chat.reviewId && !review) return c.json({ message: 'The linked review file is missing.' }, 404)
      return c.json({ review })
    } catch (error) {
      return c.json({ message: (error as Error).message }, 400)
    }
  })

  // Only this user-facing endpoint records a decision. Neither reviewer nor chat tools can manufacture one.
  app.post('/:id/legal-review/decisions', async (c) => {
    const chat = await linked(c.req.param('id'))
    if (!chat?.reviewId) return c.json({ message: 'No review is linked to this conversation.' }, 404)
    try {
      const body = await c.req.json()
      if (!Number.isSafeInteger(body.revision))
        return c.json({ message: 'Reload the review before recording a decision.' }, 400)
      const review = await store.decide(chat.reviewId, body, body.revision)
      return c.json({ review })
    } catch (error) {
      return c.json({ message: (error as Error).message }, 400)
    }
  })

  app.get('/:id/legal-review/files/:document', async (c) => {
    const chat = await linked(c.req.param('id'))
    if (!chat?.reviewId) return c.json({ message: 'No review is linked to this conversation.' }, 404)
    try {
      const review = await store.read(chat.reviewId)
      const document = review?.documents.find((item) => item.id === c.req.param('document'))
      if (!review || !document) return c.json({ message: 'No such agreement.' }, 404)
      const data = await readFile(await store.sourceFile(review, document))
      return c.body(data, 200, {
        'content-type': 'application/octet-stream',
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(document.name)}`,
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-cache',
      })
    } catch (error) {
      return c.json({ message: (error as Error).message }, 400)
    }
  })
}
