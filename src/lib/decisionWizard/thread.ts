/**
 * The chat about a wizard run is the thread `decision-<run id>`: the id is the
 * tie, so nothing else has to remember which decision a chat is about.
 * No imports here, so the page can name the thread it opens.
 */

const PREFIX = 'decision-'
const RUN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export const isRunId = (id: string): boolean => RUN.test(id)
export const decisionThreadId = (run: string): string => `${PREFIX}${run}`
/** The wizard run a thread is about, or null for any other thread. */
export const decisionRunOf = (thread: string): string | null => {
  const run = thread.startsWith(PREFIX) ? thread.slice(PREFIX.length) : ''
  return isRunId(run) ? run : null
}
