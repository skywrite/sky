/**
 * Attribute selector fixtures: starts with [field^="value"]
 */

export default [
  {
    selector: 'meeting[tags^="Acme/"]',
    expected: 'query { meetings(where: { tagsStartsWith: "Acme/" }) { path markdown } }',
    description: 'starts with - tags prefix',
  },
  {
    selector: '*[rel^="projects/"]',
    expected: 'query { documents(where: { relStartsWith: "projects/" }) { path markdown } }',
    description: 'starts with - rel prefix',
  },
]
