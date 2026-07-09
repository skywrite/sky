/**
 * Complex real-world query fixtures
 */

export default [
  {
    selector: 'message:has([from="Alice"]):has([to~="Bob"]):contains("budget")',
    expected:
      'query { messages(where: { from: "Alice", toContains: "Bob", bodyContains: "budget" }) { path markdown } }',
    description: 'complex - Alice to Bob about budget',
  },
  {
    selector: 'meeting:recent(30d):involves("Alice")[tags^="Acme/"]',
    expected:
      'query { meetings(where: { recent: "30d", involves: "Alice", tagsStartsWith: "Acme/" }) { path markdown } }',
    description: 'complex - recent Acme meetings with Alice',
  },
  {
    selector: 'person[org="MoonPay"], meeting:has([who~="MoonPay"])',
    expected:
      'query { people(where: { org: "MoonPay" }) { path markdown } meetings(where: { whoContains: "MoonPay" }) { path markdown } }',
    description: 'complex - MoonPay people and meetings',
  },
]
