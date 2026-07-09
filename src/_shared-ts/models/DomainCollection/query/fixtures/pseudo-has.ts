/**
 * Pseudo-class fixtures: :has() for relationship filtering
 */

export default [
  {
    selector: 'meeting:has([who~="Alice Smith"])',
    expected: 'query { meetings(where: { whoContains: "Alice Smith" }) { path markdown } }',
    description: 'has - who contains',
  },
  {
    selector: 'message:has([from="Alice"])',
    expected: 'query { messages(where: { from: "Alice" }) { path markdown } }',
    description: 'has - from exact',
  },
  {
    selector: 'message:has([to~="Bob"])',
    expected: 'query { messages(where: { toContains: "Bob" }) { path markdown } }',
    description: 'has - to contains',
  },
]
