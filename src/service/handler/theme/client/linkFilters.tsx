import { Checkbox, Popover } from '@mantine/core'
import { useState } from 'react'
import type { LinkKind } from '../../links/types.ts'

const TYPES: { value: LinkKind; label: string }[] = [
  { value: 'person', label: 'People' },
  { value: 'org', label: 'Orgs' },
  { value: 'project', label: 'Projects' },
  { value: 'message', label: 'Messages' },
  { value: 'meeting', label: 'Meetings' },
  { value: 'chat', label: 'Chats' },
  { value: 'note', label: 'Notes' },
  { value: 'journal', label: 'Journals' },
  { value: 'video', label: 'Videos' },
  { value: 'place', label: 'Places' },
  { value: 'library', label: 'Library' },
  { value: 'day', label: 'Days' },
]

export function linkTypesLabel(kinds: readonly LinkKind[]): string {
  const labels = TYPES.filter(({ value }) => kinds.includes(value)).map(({ label }) => label)
  if (!labels.length) return 'All types'
  if (labels.length === 1) return labels[0]!
  if (labels.length === 2) return labels.join(' and ')
  return `${labels.slice(0, -1).join(', ')}, and ${labels.at(-1)}`
}

export function linkTypesHaveDates(kinds: readonly LinkKind[]): boolean {
  return (
    kinds.length > 0 &&
    kinds.every((kind) => ['message', 'meeting', 'chat', 'note', 'journal', 'video', 'day'].includes(kind))
  )
}

export function LinkTypeFilters({
  kinds,
  onChange,
  phone,
  disabled,
  popoverOpened,
  onPopoverChange,
}: {
  kinds: LinkKind[]
  onChange: (kinds: LinkKind[]) => void
  phone: boolean
  disabled: boolean
  popoverOpened: boolean
  onPopoverChange: (opened: boolean) => void
}) {
  const [more, setMore] = useState(false)
  const checkbox = ({ value, label }: (typeof TYPES)[number]) => (
    <Checkbox
      key={value}
      className="sky-link-type-checkbox"
      color="var(--sky-action-primary)"
      iconColor="var(--sky-action-primary-text)"
      size="xs"
      radius="xs"
      classNames={{ body: 'sky-link-type-choice', label: 'sky-link-type-label' }}
      wrapperProps={{ 'data-selected': kinds.includes(value) || undefined }}
      aria-label={`Include ${label}`}
      checked={kinds.includes(value)}
      disabled={disabled}
      onChange={() => onChange(kinds.includes(value) ? kinds.filter((kind) => kind !== value) : [...kinds, value])}
      label={label}
    />
  )
  const all = (
    <button
      type="button"
      className="sky-link-all-types"
      aria-pressed={!kinds.length}
      disabled={disabled}
      onClick={() => onChange([])}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        aria-hidden="true"
      >
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
      All types
    </button>
  )
  const hidden = TYPES.slice(phone ? 3 : 5)
  const hiddenCount = hidden.filter(({ value }) => kinds.includes(value)).length
  const moreLabel = `More types${hiddenCount ? ` (${hiddenCount})` : ''}`
  return (
    <div className="sky-link-type-filters" role="group" aria-label="Filter by type" data-phone={phone || undefined}>
      {phone ? (
        <div className="sky-link-type-top">
          {all}
          <Popover
            opened={popoverOpened}
            onChange={onPopoverChange}
            position="bottom-end"
            width={270}
            shadow="md"
            trapFocus
          >
            <Popover.Target>
              <button
                type="button"
                className="sky-link-more-types"
                aria-expanded={popoverOpened}
                disabled={disabled}
                onClick={() => onPopoverChange(!popoverOpened)}
              >
                {moreLabel} ▾
              </button>
            </Popover.Target>
            <Popover.Dropdown className="sky-link-filter-popover">
              <div className="sky-link-extra-types">{hidden.map(checkbox)}</div>
            </Popover.Dropdown>
          </Popover>
        </div>
      ) : (
        <>
          <div className="sky-link-type-heading">Filter by type</div>
          {all}
        </>
      )}
      <div className="sky-link-primary-types">{TYPES.slice(0, 3).map(checkbox)}</div>
      {!phone && (
        <>
          <div className="sky-link-secondary-types">{TYPES.slice(3, 5).map(checkbox)}</div>
          <button
            type="button"
            className="sky-link-more-types"
            aria-expanded={more}
            disabled={disabled}
            onClick={() => setMore(!more)}
          >
            {more ? 'Fewer types' : moreLabel}
          </button>
          {more && <div className="sky-link-extra-types">{hidden.map(checkbox)}</div>}
        </>
      )}
    </div>
  )
}
