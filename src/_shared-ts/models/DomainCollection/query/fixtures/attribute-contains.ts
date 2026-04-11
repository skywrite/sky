/**
 * Attribute selector fixtures: contains [field~="value"]
 */

export default [
  {
    selector: 'meeting[tags~="Acme/M&A"]',
    expected: 'query { meetings(where: { tags_contains: "Acme/M&A" }) { path markdown } }',
    description: 'contains - tags',
  },
  {
    selector: 'meeting[who~="Alice Smith"]',
    expected: 'query { meetings(where: { who_contains: "Alice Smith" }) { path markdown } }',
    description: 'contains - who',
  },
  {
    selector: 'message[to~="Bob Jones"]',
    expected: 'query { messages(where: { to_contains: "Bob Jones" }) { path markdown } }',
    description: 'contains - to',
  },
]
