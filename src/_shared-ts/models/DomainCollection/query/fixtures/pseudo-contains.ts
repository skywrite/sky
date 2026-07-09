/**
 * Pseudo-class fixtures: :contains() for full-text search
 */

export default [
  {
    selector: 'meeting:contains("partnership")',
    expected: 'query { meetings(where: { bodyContains: "partnership" }) { path markdown } }',
    description: 'full-text search',
  },
  {
    selector: 'message:contains("quarterly review")',
    expected: 'query { messages(where: { bodyContains: "quarterly review" }) { path markdown } }',
    description: 'full-text search - multi-word',
  },
]
