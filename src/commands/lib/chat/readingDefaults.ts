/**
 * How much of the notebook a new chat reads, the same for every host.
 *
 * The terminal's flags default to these values and the web host passes them
 * straight through, so a reading policy cannot ship to one host and miss the
 * other. It happened once: the lean baseline became the terminal's default on
 * 2026-09-02 while the web host, built in a parallel lane a day earlier, kept
 * seeding the raw seven-day sweep — every message body of the week — until
 * 2026-10-04.
 */
export const CHAT_READING = {
  /** Days of history the baseline sweeps, today included. */
  days: 7,
  /**
   * The reading budget in the model's tokens; 0 keeps the notebook closed.
   * 500k is about what 300k read when the slider counted four-character
   * estimates: Opus 5.5 counts about 1.8 tokens for each.
   */
  contextTokens: 500_000,
  /**
   * Lean baseline: days before yesterday seed from their summary (else the
   * day ledger alone), and message bodies stay out of today's and
   * yesterday's seeds. The ledger names every capture; retrieval fetches the
   * bodies a conversation asks about.
   */
  summaryBaseline: true,
} as const
