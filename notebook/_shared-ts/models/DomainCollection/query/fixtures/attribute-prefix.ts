/**
 * Attribute selector fixtures: starts with [field^="value"]
 */

export default [
  {
    selector: 'meeting[tags^="Acme/"]',
    expected: 'query { meetings(where: { tags_starts_with: "Acme/" }) { path markdown } }',
    description: 'starts with - tags prefix',
  },
  {
    selector: '*[rel^="projects/"]',
    expected: 'query { documents(where: { rel_starts_with: "projects/" }) { path markdown } }',
    description: 'starts with - rel prefix',
  },
]
