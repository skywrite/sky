import { mkdtemp, rm } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { agreementPdf } from '#lib/legalReview/testHelpers.ts'
import type { LegalReview, ReviewContext } from '#lib/legalReview/types.ts'
import { assert, test } from '#test'
import { legalReviewTestHost } from './legalReviewTestHelpers.ts'
import { createChatRoutes } from './mod.ts'

type App = ReturnType<typeof createChatRoutes>
const json = async (app: App, url: string) => (await app.request(url)).json() as Promise<any>
const post = (app: App, url: string, body: unknown) =>
  app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const reviewOf = async (app: App, id: string): Promise<LegalReview> => (await json(app, `/${id}/legal-review`)).review

test('chat links survive recovery and filing, and response threads inherit the shared review', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sky-legal-chat-'))
  const calls: ReviewContext[] = []
  try {
    let app = createChatRoutes(legalReviewTestHost(root, calls))
    await json(app, '/main/settings')
    const form = new FormData()
    form.set(
      'message',
      JSON.stringify({
        message: 'Review these five related agreements for Atlas in chat.',
        profile: 'test-thread-model',
        contextTokens: 0,
        saves: true,
      }),
    )
    for (let index = 0; index < 5; index++) {
      const content =
        index === 1
          ? agreementPdf('Cancellation requires 30 days notice.')
          : `# Agreement ${index + 1}\n\nCancellation requires 90 days notice.`
      form.append(
        'files',
        new File(
          [typeof content === 'string' ? content : new Uint8Array(content)],
          `agreement-${index + 1}.${index === 1 ? 'pdf' : 'md'}`,
        ),
      )
    }
    const sent = await app.request('/main/messages', { method: 'POST', body: form })
    const stream = await sent.text()
    assert({
      given: 'five uploaded agreements',
      should: 'complete their direct review',
      actual: stream.includes('5 of 5 agreements'),
      expected: true,
    })
    const review = await reviewOf(app, 'main')
    const pdf = await app.request(`/main/legal-review/files/${review.documents[1].id}`)
    assert({
      given: 'the review in its owning conversation',
      should: 'retain every original and actual profile context',
      actual: {
        count: review.documents.length,
        pdf: (await pdf.text()).startsWith('%PDF-1.4'),
        profile: calls[0].instructions.includes('Atlas, the customer'),
        history: calls[0].conversation[0].role,
      },
      expected: { count: 5, pdf: true, profile: true, history: 'user' },
    })
    const decision = await post(app, '/main/legal-review/decisions', {
      findingId: review.findings[0].id,
      action: 'ask-team',
      revision: review.revision,
      source: 'ai',
    })
    assert({
      given: 'a user action in the review summary',
      should: 'record the server-controlled user source',
      actual: ((await decision.json()) as { review: LegalReview }).review.decisions[0].source,
      expected: 'user',
    })
    app = createChatRoutes(legalReviewTestHost(root, calls))
    assert({
      given: 'a service restart',
      should: 'recover the review link and decision',
      actual: { id: (await reviewOf(app, 'main')).id, decisions: (await reviewOf(app, 'main')).decisions.length },
      expected: { id: review.id, decisions: 1 },
    })
    const main = await json(app, '/main')
    const reply = (await (await post(app, '/main/replies', main.branchPoints[1])).json()) as { id: string }
    const drafted = await post(app, `/${reply.id}/messages`, {
      message: 'Draft the response in my voice.',
      profile: 'test-thread-model',
      contextTokens: 0,
      saves: true,
    })
    await drafted.text()
    assert({
      given: 'an explicit response thread',
      should: 'share the review while keeping drafting out of the main conversation',
      actual: { id: (await reviewOf(app, reply.id)).id, mainTurns: (await json(app, '/main')).turns.length },
      expected: { id: review.id, mainTurns: 2 },
    })
    const filed = (await (await post(app, '/main/end', { save: true })).json()) as { saved: { path: string } }
    app = createChatRoutes(legalReviewTestHost(root, calls))
    const opened = (await (await post(app, '/open', { chat: path.relative(root, filed.saved.path) })).json()) as {
      id: string
    }
    assert({
      given: 'the filed chat opened in a fresh service',
      should: 'load the same notebook review and decision history',
      actual: { id: (await reviewOf(app, opened.id)).id, decisions: (await reviewOf(app, opened.id)).decisions.length },
      expected: { id: review.id, decisions: 1 },
    })
    const stale = await post(app, `/${opened.id}/legal-review/decisions`, {
      findingId: review.findings[0].id,
      action: 'accept-risk',
      revision: -1,
    })
    assert({
      given: 'a decision made against obsolete review content',
      should: 'reject it',
      actual: stale.status,
      expected: 400,
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
