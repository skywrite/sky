---
created: 2026-10-01
updated: 2026-10-01
---

# Old contact keeps fading

Recency decay stopped at a permanent floor. Every interaction older than a
year kept 5% of its weight forever, so a relationship that ended years ago
still added up. Fifteen meetings two and a half years ago scored 7.5. One
meeting last month scored 5. Ranked by score, the dormant namesake led.

Past two years the multiplier now halves each further year: 0.05 for one
to two years, 0.025 in the third, 0.0125 in the fourth, and so on. The
first two years are unchanged. The dormant contact above now scores 3.75
and falls behind last month's meeting.

Rejected:

- A lower floor, such as 0.01 past two years. It fixes this example, but a
  large enough history of any age still keeps its weight forever.
- Zero past two years. It erases history: a long-dormant colleague ties a
  stranger. On a real notebook it also changed far more bare-name
  resolutions than halving, including outright winner swaps.

Each rule was measured read-only by rescanning a real notebook into a
scratch store; the counts stay out of the repo.

Effects beyond ranking:

- The resolver's 3× dominance rule favors recent contact more often. A few
  long-dormant contacts become too close to a recent namesake to decide,
  and the model judges those.
- Familiarity follows the same decay. A person known only from years ago
  can drop below the threshold for a short calendar label.
- Tag and org scores use the same multiplier.

Coverage: `store_test.ts` checks the year boundaries and a dormant history
that keeps fading.
