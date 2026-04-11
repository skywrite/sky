/**
 * Complex real-world query fixtures
 */

export default [
  {
    selector: 'message:has([from="Alice"]):has([to~="Bob"]):contains("budget")',
    expected:
      'query { messages(where: { from: "Alice", to_contains: "Bob", body_contains: "budget" }) { path markdown } }',
    description: 'complex - Alice to Bob about budget',
  },
  {
    selector: 'meeting:recent(30d):involves("Alice")[tags^="Acme/"]',
    expected:
      'query { meetings(where: { recent: "30d", involves: "Alice", tags_starts_with: "Acme/" }) { path markdown } }',
    description: 'complex - recent Acme meetings with Alice',
  },
  {
    selector: 'person[org="MoonPay"], meeting:has([who~="MoonPay"])',
    expected:
      'query { people(where: { org: "MoonPay" }) { path markdown } meetings(where: { who_contains: "MoonPay" }) { path markdown } }',
    description: 'complex - MoonPay people and meetings',
  },
]
