import { ActionIcon, Tooltip } from '@mantine/core'

export function DayChatResume({ onClick }: { onClick: () => void }) {
  return (
    <Tooltip label="Continue chat" withArrow>
      <ActionIcon size={28} variant="primary-quiet" aria-label="Continue chat" onClick={onClick}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M14 5H6a3 3 0 0 0-3 3v7a3 3 0 0 0 3 3h2v4l5-4h5a3 3 0 0 0 3-3v-3M16 3l4 4-4 4m-5-4h9"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </ActionIcon>
    </Tooltip>
  )
}
