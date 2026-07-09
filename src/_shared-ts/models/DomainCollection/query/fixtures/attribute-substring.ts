/**
 * Attribute selector fixtures: substring [field*="value"]
 */

export default [
  {
    selector: 'meeting[summary*="partnership"]',
    expected: 'query { meetings(where: { summaryContains: "partnership" }) { path markdown } }',
    description: 'substring - summary',
  },
]
