import { Button } from '@mantine/core'
import type { useDayPriority } from './useDayPriority.ts'

export function PriorityStatus({
  status,
  suggestions,
  paused,
}: {
  status?: { warning?: string; connection?: boolean }
  suggestions: ReturnType<typeof useDayPriority>
  paused: boolean
}) {
  if (paused) return null
  if (status?.warning || suggestions.failure)
    return (
      <div className="sky-todo-priority-status" role="status">
        <span>{status?.warning ?? 'Sky could not update priorities. Your existing order is still available.'}</span>
        {status?.connection ? (
          <Button component="a" href="/settings/connections" variant="secondary">
            Connect TypeSafe
          </Button>
        ) : (
          <Button variant="secondary" disabled={suggestions.loading} onClick={suggestions.retry}>
            Retry
          </Button>
        )}
      </div>
    )
  return suggestions.loading ? (
    <div className="sky-todo-priority-status" role="status">
      Sky is prioritizing…
    </div>
  ) : null
}
