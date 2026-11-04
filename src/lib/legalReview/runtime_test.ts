import { readdir, rm } from 'node:fs/promises'
import * as path from 'node:path'
import { assert, test } from '#test'
import { createLegalReviewer } from './runtime.ts'
import { REVIEW_CONTEXT, reviewFixture } from './testHelpers.ts'

test('a review keeps its record and agreement copies in Sky state, never in a day folder', async () => {
  const fixture = await reviewFixture()
  try {
    const state = path.join(fixture.root, 'state')
    const reviewer = createLegalReviewer({ DIR_STATE: state })
    const review = await reviewer.register({ sources: fixture.sources.slice(0, 2), context: REVIEW_CONTEXT })
    const inside = (file: string) => path.relative(path.join(state, 'legal-reviews'), file).split(path.sep)[0]
    assert({
      given: 'two agreements registered for a review in a notebook',
      should: 'save the record and both copies under the state folder and add nothing beside the notebook’s files',
      actual: {
        record: inside(reviewer.store.file(review.id)),
        copies: await Promise.all(
          review.documents.map(async (document) => inside(await reviewer.store.sourceFile(review, document))),
        ),
        notebook: (await readdir(fixture.root)).sort(),
      },
      expected: { record: `${review.id}.md`, copies: [review.id, review.id], notebook: ['incoming', 'state'] },
    })
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})
