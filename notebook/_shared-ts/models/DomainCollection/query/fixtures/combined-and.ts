/**
 * Combined condition fixtures: AND (chained selectors)
 */

export default [
  {
    selector: 'meeting[year="2025"][tags~="Acme/M&A"]',
    expected: 'query { meetings(where: { year: 2025, tags_contains: "Acme/M&A" }) { path markdown } }',
    description: 'AND - year and tags',
  },
  {
    selector: 'meeting:recent(7d)[medium="Zoom"]',
    expected: 'query { meetings(where: { recent: "7d", medium: "Zoom" }) { path markdown } }',
    description: 'AND - recent and medium',
  },
  {
    selector: 'meeting:recent(7d)[medium="Zoom"]:has([who~="Alice"])',
    expected: 'query { meetings(where: { recent: "7d", who_contains: "Alice", medium: "Zoom" }) { path markdown } }',
    description: 'AND - three conditions',
  },
  {
    selector: 'decision:pending[tags~="Finance"]',
    expected: 'query { decisions(where: { pending: true, tags_contains: "Finance" }) { path markdown } }',
    description: 'AND - status and tags',
  },
  {
    selector: 'meeting[tags~="Acme/Product/GTM"][tags~="Acme/Marketing/GTM"]',
    expected:
      'query { meetings(where: { tags_contains_all: ["Acme/Product/GTM", "Acme/Marketing/GTM"] }) { path markdown } }',
    description: 'AND - repeated tags~= becomes tags_contains_all',
  },
  {
    selector: 'meeting:recent(30d)[tags~="Finance"][tags~="Legal"]',
    expected: 'query { meetings(where: { recent: "30d", tags_contains_all: ["Finance", "Legal"] }) { path markdown } }',
    description: 'AND - recent with multiple tags',
  },
]
