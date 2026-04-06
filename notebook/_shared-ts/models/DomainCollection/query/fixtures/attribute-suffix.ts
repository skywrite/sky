/**
 * Attribute selector fixtures: ends with [field$="value"]
 */

export default [
  {
    selector: 'person[name$="Smith"]',
    expected: 'query { people(where: { name_ends_with: "Smith" }) { path markdown } }',
    description: 'ends with - name suffix',
  },
]
