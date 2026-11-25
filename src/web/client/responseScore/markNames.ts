/** How each mark reads on screen, in the order of `RESPONSE_MARK_HOURS`. */
export const MARK_NAMES = ['1 hour', '4 hours', '12 hours', '1 day', '3 days'] as const

/** The same marks where a chart has little room. */
export const MARK_NAMES_SHORT = ['1h', '4h', '12h', '1 day', '3 days'] as const

/** The groups a wait can end in, quickest first, in the order of `RESPONSE_POINTS`. */
export const WAIT_GROUPS = [
  'Within 1 hour',
  '1 to 4 hours',
  '4 to 12 hours',
  '12 to 24 hours',
  '1 to 3 days',
  'Over 3 days, or no reply',
] as const
