import { Button } from '@mantine/core'
import { useEffect, useRef, useState } from 'react'
import { useDraftEdits, useOutboxReport } from './outboxHooks.ts'
import { OutboxItemPage } from './outboxItem.tsx'
import { useOutboxItemEditor } from './outboxItemEditor.ts'
import { OutboxList, type OutboxTab } from './outboxList.tsx'
import { Pen } from './outboxParts.tsx'
import { outboxHeading } from './outboxPresentation.ts'
import { OutboxRail } from './outboxRail.tsx'
import { outboxHref } from './outboxRoutes.ts'
import { useRail } from './rail.ts'
import { RailToggle } from './railToggle.tsx'
import { type OpenReplyThread, ReplyThreadPanel } from './replyThreads.tsx'
import './outbox.css'

/**
 * The outbox: the list at `/outbox`, one item's page at `/outbox/<id>`.
 * The path is the state — a row is a link, back is a link — so any item
 * can be opened, shared, and returned to.
 */

export function OutboxMain({ item, navigate }: { item: string; navigate: (path: string) => void }) {
  const { report, setReport, connectionError, setConnectionError, refresh } = useOutboxReport(Boolean(item))
  const edits = useDraftEdits(report, item)
  const rail = useRail(item)
  const [tab, setTab] = useState<OutboxTab>('review')
  const [discussion, setDiscussion] = useState<OpenReplyThread | null>(null)
  const [discussionOpen, setDiscussionOpen] = useState(false)
  const scroll = useRef<HTMLDivElement>(null)
  const listPosition = useRef(0)
  const editor = useOutboxItemEditor({
    id: item,
    report,
    setReport,
    edits,
    refresh,
    setConnectionError,
    openDiscussion: (thread) => {
      setDiscussion(thread)
      setDiscussionOpen(true)
    },
    onLeave: (reason) => {
      if (reason === 'sent') setTab('review')
      navigate('/outbox')
    },
  })
  const record = item ? editor.item : undefined
  useEffect(() => {
    document.title = record ? `sky:outbox - ${outboxHeading(record)}` : 'sky · outbox'
  }, [record])
  // The list keeps its place: an item opens at its top, the way back lands where the person was.
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = item ? 0 : listPosition.current
  }, [item])
  useEffect(() => {
    setDiscussion(null)
    setDiscussionOpen(false)
  }, [item])
  const open = (id: string) => {
    listPosition.current = scroll.current?.scrollTop ?? 0
    navigate(outboxHref(id))
  }
  const working = report?.check?.running === true || editor.composing
  const railShown = Boolean(item && record && rail.open && !discussionOpen)

  return (
    <div className="sky-main sky-outbox sky-main-rail">
      <div className="sky-doc-column">
        <header className="sky-head">
          {item ? (
            <Button size="sm" style={{ marginLeft: -10 }} onClick={() => navigate('/outbox')}>
              ‹ Outbox
            </Button>
          ) : (
            <span className="sky-title">Outbox</span>
          )}
          <span className="sky-spacer" />
          <Button leftSection={<Pen />} onClick={() => navigate('/settings/writing-voice')}>
            Your voice
          </Button>
          {item && !rail.open && <RailToggle open={false} onClick={rail.toggle} disabled={!record} />}
        </header>
        <div className="sky-outbox-layout" data-reply-open={discussionOpen || undefined}>
          <div className="sky-scroll" ref={scroll}>
            <div className="sky-outbox-column">
              {connectionError && (
                <div className="sky-outbox-notice" role="status">
                  Reconnecting to Sky…{working ? ' Your work continues in the background.' : ''}
                </div>
              )}
              {item ? (
                <OutboxItemPage editor={editor} today={report?.today ?? ''} open={open} railShown={railShown} />
              ) : (
                <OutboxList
                  report={report}
                  tab={tab}
                  onTab={setTab}
                  edits={edits}
                  open={open}
                  refresh={refresh}
                  setConnectionError={setConnectionError}
                  navigate={navigate}
                />
              )}
            </div>
          </div>
          {discussion && record && (
            <ReplyThreadPanel
              key={discussion.id}
              thread={discussion}
              visible={discussionOpen}
              onClose={() => {
                setDiscussionOpen(false)
                void refresh()
              }}
            />
          )}
        </div>
      </div>
      {railShown && <OutboxRail item={record!} onToggle={rail.toggle} navigate={navigate} />}
    </div>
  )
}
