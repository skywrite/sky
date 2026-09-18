export const WORKSTREAM_COLORS = ['blue', 'violet', 'mint', 'green', 'orange', 'red', 'yellow', 'quiet'] as const

export type WorkstreamColor = (typeof WORKSTREAM_COLORS)[number]
