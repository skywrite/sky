/**
 * Pseudo-class fixtures: :involves() for person involvement across fields
 */

export default [
  {
    selector: '*:involves("Bob Smith")',
    expected: 'query { documents(where: { involves: "Bob Smith" }) { path markdown } }',
    description: 'involves - all documents',
  },
  {
    selector: 'meeting:involves("Alice")',
    expected: 'query { meetings(where: { involves: "Alice" }) { path markdown } }',
    description: 'involves - meetings only',
  },
]
