/**
 * Pseudo-class fixtures: time-based (:today, :yesterday, :recent, :date)
 */

export default [
  {
    selector: 'meeting:today',
    expected: 'query { meetings(where: { date: "$TODAY" }) { path markdown } }',
    description: 'today pseudo-class',
    dynamic: true,
  },
  {
    selector: 'meeting:yesterday',
    expected: 'query { meetings(where: { date: "$YESTERDAY" }) { path markdown } }',
    description: 'yesterday pseudo-class',
    dynamic: true,
  },
  {
    selector: 'meeting:recent(7d)',
    expected: 'query { meetings(where: { recent: "7d" }) { path markdown } }',
    description: 'recent - 7 days',
  },
  {
    selector: 'meeting:recent(2w)',
    expected: 'query { meetings(where: { recent: "2w" }) { path markdown } }',
    description: 'recent - 2 weeks',
  },
  {
    selector: 'meeting:recent(3m)',
    expected: 'query { meetings(where: { recent: "3m" }) { path markdown } }',
    description: 'recent - 3 months',
  },
  {
    selector: 'meeting:date(2025-01-15)',
    expected: 'query { meetings(where: { date: "2025-01-15" }) { path markdown } }',
    description: 'specific date',
  },
  {
    selector: 'meeting:date-range(2025-01-01, 2025-01-31)',
    expected: 'query { meetings(where: { date_gte: "2025-01-01", date_lte: "2025-01-31" }) { path markdown } }',
    description: 'date range',
  },
]
