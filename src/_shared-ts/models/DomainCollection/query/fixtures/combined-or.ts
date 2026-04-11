/**
 * Combined condition fixtures: OR (comma-separated selectors)
 */

export default [
  {
    selector: 'meeting:today, message:today',
    expected:
      'query { meetings(where: { date: "$TODAY" }) { path markdown } messages(where: { date: "$TODAY" }) { path markdown } }',
    description: 'OR - meetings or messages today',
    dynamic: true,
  },
  {
    selector: 'meeting, message, decision',
    expected: 'query { meetings { path markdown } messages { path markdown } decisions { path markdown } }',
    description: 'OR - multiple types',
  },
]
