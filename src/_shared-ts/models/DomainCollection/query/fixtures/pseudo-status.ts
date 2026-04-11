/**
 * Pseudo-class fixtures: status (:pending, :decided)
 */

export default [
  {
    selector: 'decision:pending',
    expected: 'query { decisions(where: { pending: true }) { path markdown } }',
    description: 'pending decisions',
  },
  {
    selector: 'decision:decided',
    expected: 'query { decisions(where: { decided: true }) { path markdown } }',
    description: 'decided decisions',
  },
]
