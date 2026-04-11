/**
 * Pseudo-class fixtures: :contains() for full-text search
 */

export default [
  {
    selector: 'meeting:contains("partnership")',
    expected: 'query { meetings(where: { body_contains: "partnership" }) { path markdown } }',
    description: 'full-text search',
  },
  {
    selector: 'message:contains("quarterly review")',
    expected: 'query { messages(where: { body_contains: "quarterly review" }) { path markdown } }',
    description: 'full-text search - multi-word',
  },
]
