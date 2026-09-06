import { ActionIcon } from '@mantine/core'

/**
 * The rail's one control: a chevron in its top-left corner that folds the
 * rail away to the right. Folded, the same chevron waits at the end of the
 * page's header, pointing back at where the rail was. Both the day's rail
 * and a document's use it, so the two fold alike.
 */
export function RailToggle({
  open,
  onClick,
  disabled = false,
}: {
  open: boolean
  onClick: () => void
  disabled?: boolean
}) {
  const label = open ? 'Hide details' : 'Show details'
  return (
    <ActionIcon
      size="sm"
      radius="sm"
      className="sky-rail-toggle"
      data-open={open}
      aria-label={label}
      aria-expanded={open}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path
          d="M4.5 2.5 8 6 4.5 9.5"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </ActionIcon>
  )
}
