/**
 * Attribute selector fixtures: substring [field*="value"]
 */

export default [
  {
    selector: 'meeting[summary*="partnership"]',
    expected: 'query { meetings(where: { summary_contains: "partnership" }) { path markdown } }',
    description: 'substring - summary',
  },
]
