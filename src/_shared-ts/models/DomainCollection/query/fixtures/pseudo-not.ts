/**
 * Pseudo-class fixtures: :not() for negation
 */

export default [
  {
    selector: 'decision:not([decided])',
    expected: 'query { decisions(where: { decidedIsNull: true }) { path markdown } }',
    description: 'not - field missing (pending)',
  },
  {
    selector: 'person:not([org])',
    expected: 'query { people(where: { orgIsNull: true }) { path markdown } }',
    description: 'not - no org',
  },
  {
    selector: 'meeting:not([tags])',
    expected: 'query { meetings(where: { tagsIsNull: true }) { path markdown } }',
    description: 'not - untagged',
  },
  {
    selector: 'meeting:not([tags^="Acme/"])',
    expected: 'query { meetings(where: { tagsNotStartsWith: "Acme/" }) { path markdown } }',
    description: 'not - negated prefix',
  },
]
