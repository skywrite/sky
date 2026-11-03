import './RecurringMain.css'
import { ActionIcon, Button, Menu } from '@mantine/core'
import { useEffect, useState } from 'react'
import { recurringPatternLabel } from '#universal/dates/recurring/display.ts'
import type { RecurringItem, RecurringSource } from '../../../service/handler/recurring/types.ts'
import { fileHref } from '../explorer/explorer.tsx'
import { Editor } from './Editor.tsx'
import { useRecurring } from './useRecurring.ts'

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'professional', label: 'Professional' },
  { value: 'personal', label: 'Personal' },
  { value: 'reminders', label: 'Reminders' },
] as const
type Filter = RecurringSource | 'all'

export function RecurringMain({ search, navigate }: { search: string; navigate: (to: string) => void }) {
  const category = new URLSearchParams(search).get('category')
  const filter: Filter =
    category === 'personal' || category === 'professional' || category === 'reminders' ? category : 'all'
  const [editor, setEditor] = useState<{ item: RecurringItem | null; stop?: boolean } | null>(null)
  const [notice, setNotice] = useState('')
  const { report, error, reload, accept } = useRecurring(editor !== null)
  useEffect(() => {
    if (!editor)
      document.title =
        filter === 'all'
          ? 'sky · Recurring'
          : 'sky · Recurring · ' + FILTERS.find((entry) => entry.value === filter)!.label
  }, [filter, editor])
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), 7000)
    return () => clearTimeout(timer)
  }, [notice])
  const items = report?.items ?? []
  const groups = FILTERS.filter((group) => group.value !== 'all' && (filter === 'all' || filter === group.value))
  const count = (source: Filter) => items.filter((item) => source === 'all' || item.source === source).length
  const add = () => setEditor({ item: null })
  return (
    <main className="sky-main sky-recurring-main">
      <div className="sky-scroll">
        <div className="sky-col sky-recurring-col">
          <header className="sky-recurring-heading">
            <div>
              <h1>Recurring</h1>
              <p>Choose what Sky adds to your day.</p>
            </div>
            <Button variant="primary" onClick={add} disabled={!report}>
              ＋ Add recurring
            </Button>
          </header>
          <div className="sky-recurring-filters" role="group" aria-label="Filter recurring items">
            {FILTERS.map((entry) => (
              <button
                key={entry.value}
                type="button"
                aria-pressed={filter === entry.value}
                onClick={() => navigate('/recurring' + (entry.value === 'all' ? '' : '?category=' + entry.value))}
              >
                {entry.label}
                {report && <span>{count(entry.value)}</span>}
              </button>
            ))}
          </div>
          {error && (
            <div className="sky-recurring-error" role="alert">
              <p>{error}</p>
              <Button onClick={() => void reload()}>Try again</Button>
            </div>
          )}
          {!report && !error && (
            <p className="sky-recurring-help" role="status">
              Loading recurring items…
            </p>
          )}
          {notice && (
            <p className="sky-recurring-notice" role="status">
              {notice}
            </p>
          )}
          {report && !count(filter) && (
            <div className="sky-recurring-empty">
              <h2>{items.length ? 'Start a new rhythm' : 'A little less to remember'}</h2>
              <p>Put regular to-dos and reminders on your day automatically.</p>
              <Button variant="primary" onClick={add}>
                Add your first {filter === 'reminders' ? 'reminder' : 'recurring item'}
              </Button>
            </div>
          )}
          {groups.map((group) => {
            const rows = items.filter((item) => item.source === group.value)
            if (!rows.length) return null
            return (
              <section className="sky-recurring-group" key={group.value} aria-label={group.label}>
                <h2>
                  {group.label}
                  <span>{rows.length}</span>
                </h2>
                {rows.map((item) => (
                  <div className="sky-recurring-row" key={item.id}>
                    <button
                      className="sky-recurring-open"
                      type="button"
                      onClick={() => setEditor({ item })}
                      aria-label={'Edit recurrence: ' + item.text}
                    >
                      <span className="sky-recurring-item-content">
                        <span className="sky-recurring-item-title">{item.text}</span>
                        <span className="sky-recurring-item-meta">
                          {recurringPatternLabel(item.pattern)}
                          {item.time ? ' · ' + item.time : ''} · {item.kind === 'reminder' ? 'Reminder' : 'To-do'}
                        </span>
                        {!item.valid && (
                          <span className="sky-recurring-invalid">
                            This schedule is not recognized. Choose a repeat schedule to include it in future days.
                          </span>
                        )}
                      </span>
                      {item.dates[0] && (
                        <span className="sky-recurring-next" data-today={item.dates[0] === report?.today}>
                          <span>{item.dates[0] === report?.today ? 'Today' : 'Next'}</span>
                          <time dateTime={item.dates[0]}>{item.dates[0]}</time>
                        </span>
                      )}
                    </button>
                    <Menu position="bottom-end" width={200}>
                      <Menu.Target>
                        <ActionIcon variant="secondary" aria-label={'Options for ' + item.text}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                            <circle cx="5" cy="12" r="1.5" />
                            <circle cx="12" cy="12" r="1.5" />
                            <circle cx="19" cy="12" r="1.5" />
                          </svg>
                        </ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Item onClick={() => setEditor({ item })}>Edit recurrence</Menu.Item>
                        <Menu.Item className="sky-recurring-stop" onClick={() => setEditor({ item, stop: true })}>
                          Stop repeating
                        </Menu.Item>
                      </Menu.Dropdown>
                    </Menu>
                  </div>
                ))}
              </section>
            )
          })}
          {report && (
            <footer className="sky-recurring-footer">
              <span>Added when you start a matching day.</span>
              <div aria-label="Source files">
                {report.files
                  .filter((file) => file.exists)
                  .map((file) => (
                    <a
                      key={file.source}
                      href={fileHref(file.path)}
                      onClick={(event) => {
                        if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
                        event.preventDefault()
                        navigate(fileHref(file.path))
                      }}
                    >
                      {FILTERS.find((entry) => entry.value === file.source)!.label} source
                    </a>
                  ))}
              </div>
            </footer>
          )}
        </div>
      </div>
      {editor && report && (
        <Editor
          key={editor.item?.id ?? 'new'}
          item={editor.item}
          files={report.files}
          defaultSource={filter}
          stop={editor.stop}
          onClose={() => setEditor(null)}
          onSaved={(next, message) => {
            accept(next)
            setEditor(null)
            setNotice(message)
          }}
        />
      )}
    </main>
  )
}
