/**
 * Pseudo-class fixtures: :not() for negation
 */

export default [
  {
    selector: 'decision:not([decided])',
    expected: 'query { decisions(where: { decided_is_null: true }) { path markdown } }',
    description: 'not - field missing (pending)',
  },
  {
    selector: 'person:not([org])',
    expected: 'query { people(where: { org_is_null: true }) { path markdown } }',
    description: 'not - no org',
  },
  {
    selector: 'meeting:not([tags])',
    expected: 'query { meetings(where: { tags_is_null: true }) { path markdown } }',
    description: 'not - untagged',
  },
  {
    selector: 'meeting:not([tags^="Acme/"])',
    expected: 'query { meetings(where: { tags_not_starts_with: "Acme/" }) { path markdown } }',
    description: 'not - negated prefix',
  },
]
