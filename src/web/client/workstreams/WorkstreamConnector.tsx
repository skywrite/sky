import { ActionIcon } from '@mantine/core'

export function WorkstreamConnector({
  workstreamId,
  title,
  zoom,
  disabled,
  onRelate,
}: {
  workstreamId: string
  title: string
  zoom: number
  disabled: boolean
  onRelate: (fromId: string) => void
}) {
  return (
    <ActionIcon
      className="sky-workstreams-connector"
      aria-label={`Relate ${title} to another workstream`}
      title="Drag to another workstream to relate them, or click to choose."
      variant="secondary"
      data-canvas-control
      data-workstream-connector={workstreamId}
      disabled={disabled}
      style={{ transform: `translate(50%, -50%) scale(${1 / zoom})` }}
      onClick={(event) => {
        if (event.detail === 0 && !disabled) onRelate(workstreamId)
      }}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        aria-hidden="true"
      >
        <path d="M8 5H5a5 5 0 0 0 0 10h3m4-10h3a5 5 0 0 1 0 10h-3M6 10h8" />
      </svg>
    </ActionIcon>
  )
}
