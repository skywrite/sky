/**
 * Attribute selector fixtures: exact match [field="value"]
 */

export default [
  {
    selector: 'meeting[year="2025"]',
    expected: 'query { meetings(where: { year: 2025 }) { path markdown } }',
    description: 'exact match - year',
  },
  {
    selector: 'person[org="MoonPay"]',
    expected: 'query { people(where: { org: "MoonPay" }) { path markdown } }',
    description: 'exact match - org',
  },
  {
    selector: 'message[medium="Slack"]',
    expected: 'query { messages(where: { medium: "Slack" }) { path markdown } }',
    description: 'exact match - medium',
  },
]
