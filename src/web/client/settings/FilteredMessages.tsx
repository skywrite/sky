import { Button } from '@mantine/core'
import { Block, plural, sinceLabel } from './settingsBlocks.tsx'
import './FilteredMessages.css'

export type FilteredMessage = {
  chat: string
  network: string
  who: string
  first: string
  at: string
  count: number
  reason?: 'first-time pitch'
}

const icons = {
  filter: <path d="M4 5h16M7 12h10M10 19h4" />,
  pitch: (
    <>
      <path d="M4 9h4l12-5v16L8 15H4V9Zm4 6 2 6h4l-2-4.3M8 9v6" />
    </>
  ),
  unknown: (
    <>
      <circle cx="9" cy="7" r="3.5" />
      <path d="M3 21v-2a6 6 0 0 1 10-4.5M17 13a2 2 0 1 1 3.2 1.6c-.8.5-1.2.9-1.2 1.9M19 20h.01" />
    </>
  ),
  message: <path d="M20 4H4a1 1 0 0 0-1 1v15l4-4h13a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1Z" />,
  add: (
    <>
      <path d="M12 5H5a2 2 0 0 0-2 2v12a2 2 0 0 1 2-2h14V9M3 19a2 2 0 0 0 2 2h14M7 5v12M18 2v6m-3-3h6" />
    </>
  ),
  open: <path d="M14 3h7v7m0-7L10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" />,
}

function FilteredIcon({ name }: { name: keyof typeof icons }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {icons[name]}
    </svg>
  )
}

export function FilteredMessages({
  messages,
  busy,
  onAdd,
  onOpen,
}: {
  messages: FilteredMessage[]
  busy: boolean
  onAdd: (chat: string) => void
  onOpen: (chat: string) => void
}) {
  return (
    <Block
      head={
        <>
          <FilteredIcon name="filter" />
          Filtered messages <span className="sky-filtered-count">{messages.length}</span>
        </>
      }
      note="These messages stay in Beeper and haven’t been added to your notebook. Add a conversation to allow its future messages too."
    >
      <ul className="sky-filtered-messages" aria-label="Filtered conversations">
        {messages.map((entry) => {
          const pitch = entry.reason === 'first-time pitch'
          return (
            <li className="sky-filtered-message" data-reason={pitch ? 'pitch' : 'unknown'} key={entry.chat}>
              <span className="sky-filtered-avatar">
                <FilteredIcon name={pitch ? 'pitch' : 'unknown'} />
              </span>
              <div className="sky-filtered-content">
                <div className="sky-filtered-heading">
                  <h3>{entry.who}</h3>
                  <span className="sky-filtered-reason">{pitch ? 'Likely cold outreach' : 'Unknown sender'}</span>
                </div>
                <div className="sky-filtered-meta">
                  <span className="sky-filtered-network">
                    <FilteredIcon name="message" />
                    {entry.network}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{plural(entry.count, 'message')}</span>
                  <span aria-hidden="true">·</span>
                  <time dateTime={entry.at}>{sinceLabel(entry.at)}</time>
                </div>
                <p className="sky-filtered-preview">{entry.first || 'Open in Beeper to view this message.'}</p>
                <div className="sky-filtered-actions">
                  <Button
                    size="compact-sm"
                    leftSection={<FilteredIcon name="open" />}
                    disabled={busy}
                    onClick={() => onOpen(entry.chat)}
                  >
                    Open in Beeper
                  </Button>
                  <Button
                    size="compact-sm"
                    variant="primary-quiet"
                    leftSection={<FilteredIcon name="add" />}
                    disabled={busy}
                    onClick={() => onAdd(entry.chat)}
                  >
                    Add to notebook
                  </Button>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </Block>
  )
}
