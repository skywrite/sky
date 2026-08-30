import '@mantine/core/styles.css'
import './shell.css'
import { ActionIcon, Button, Checkbox, MantineProvider, Textarea, useMantineColorScheme } from '@mantine/core'
import { Fragment, type MouseEvent, useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AuditionMain } from './audition.tsx'
import { ChatMain, type Note, threadTitle, useChat } from './chat.tsx'
import { DayView, useDay, useThreads } from './day.tsx'
import { DocView, explorerFileOf, fileHref, Tree } from './explorer.tsx'
import { skyTheme } from './theme.ts'
import { VoiceMain } from './voice.tsx'

/**
 * /theme — the living style guide.
 *
 * The v4.5 concept screen rebuilt in real Mantine components on the sky theme.
 * Every future surface should look like this page; when the theme changes,
 * this page is where it changes first. All content is synthetic.
 */

const DAYS = [
  { label: 'Today', meta: 'Fri 08-01', view: 'today' as const },
  { label: 'Yesterday', meta: 'Thu 07-31', view: 'yesterday' as const },
  { label: 'Wednesday', meta: '07-30' },
  { label: 'Tuesday', meta: '07-29' },
]

const HORIZONS = [
  { label: 'This week', meta: 'w31' },
  { label: 'Next week', meta: 'w32' },
]

const TOPICS = [
  { label: 'Atlas pricing', meta: '3d' },
  { label: 'Retreat planning', meta: '1w' },
]

type View = 'today' | 'yesterday'

function App() {
  const isThemePage = window.location.pathname.startsWith('/theme')
  return (
    <MantineProvider theme={skyTheme} defaultColorScheme="light">
      {isThemePage ? <Shell /> : <Canvas />}
    </MantineProvider>
  )
}

/** The path is the state: `/` is today, `/<ymd>` another day, `/thread/<id>` a conversation. */
function useRoute(): [string, (to: string) => void] {
  const [path, setPath] = useState(window.location.pathname)
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const navigate = useCallback((to: string) => {
    history.pushState(null, '', to)
    setPath(to)
  }, [])
  return [path, navigate]
}

/**
 * The real app. The day is the page; a thread is a page of its own that
 * comes back to the day. /theme stays the reference for how it should look.
 */
function Canvas() {
  const [path, go] = useRoute()
  const [menu, setMenu] = useState(false)
  // On a phone the sidebar is a drawer; any navigation closes it.
  const navigate = (to: string) => {
    setMenu(false)
    go(to)
  }
  const threadId = path.match(/^\/thread\/([^/]+)/)?.[1] ?? null
  const dayYmd = path.match(/^\/(\d{4}-\d{2}-\d{2})$/)?.[1] ?? null
  const isVoice = path === '/voice'
  const isAudition = path === '/voice/audition'
  // '' is the explorer itself, a path is a file open in it, null is any other page.
  const explorerFile = explorerFileOf(path)
  const day = useDay(dayYmd)
  const threads = useThreads()
  const [notes, setNotes] = useState<Note[]>([])

  // A day's own conversation is a thread whose id is the day; those stay off the Threads list.
  const dayThreadId = day ? `day-${day.day.ymd}` : ''
  const chat = useChat(threadId ?? dayThreadId)
  const isToday = dayYmd === null
  const others = threads.filter((t) => !t.id.startsWith('day-'))

  const openThread = (id: string) => navigate(`/thread/${id}`)
  const newChat = () => openThread(crypto.randomUUID())
  // Back to the day at once. The save — enrichment included — finishes behind
  // the Running block, and its note lands in the day when it does.
  const endThread = () => {
    const saving = chat.end(true)
    navigate('/')
    void saving.then((notes) => setNotes((prev) => [...prev, ...notes]))
  }
  // A link into the explorer — a row on the day, a link inside a document — turns the page in place.
  const onLinkClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const anchor = (event.target as Element).closest('a')
    if (!anchor?.href) return
    const url = new URL(anchor.href)
    if (url.origin !== location.origin || !url.pathname.startsWith('/explorer/')) return
    event.preventDefault()
    navigate(url.pathname)
  }

  return (
    <div className="sky-app" onClick={onLinkClick}>
      <button
        type="button"
        className="sky-menu"
        aria-label={menu ? 'Close' : explorerFile !== null ? 'Files' : 'Days and threads'}
        aria-expanded={menu}
        onClick={() => setMenu((open) => !open)}
      >
        {menu ? '×' : '≡'}
      </button>
      {menu && <div className="sky-scrim" onClick={() => setMenu(false)} />}
      <nav className="sky-side" data-open={menu}>
        <div className="sky-side-top">
          <span className="sky-brand">sky</span>
          <SchemeToggle />
        </div>
        {explorerFile !== null ? (
          <>
            <button type="button" className="sky-thread" onClick={() => navigate('/')}>
              <span>‹ Today</span>
            </button>
            <div className="sky-side-label">Explorer</div>
            <Tree file={explorerFile} onOpen={(file) => navigate(fileHref(file))} />
          </>
        ) : (
          <>
            <Button className="sky-newchat" fullWidth justify="flex-start" onClick={newChat}>
              ＋ New chat
            </Button>
            {/* A voice session is its own page, off the day like a thread. */}
            <button type="button" className="sky-thread" data-active={isVoice} onClick={() => navigate('/voice')}>
              <span>Talk</span>
              <span className="sky-meta">voice</span>
            </button>

            <div className="sky-side-label">Days</div>
            {(day?.days ?? []).map((d, offset) => (
              <button
                key={d.ymd}
                type="button"
                className="sky-thread"
                data-active={threadId === null && !isVoice && (offset === 0 ? isToday : dayYmd === d.ymd)}
                onClick={() => navigate(offset === 0 ? '/' : `/${d.ymd}`)}
              >
                <span>{d.label}</span>
                <span className="sky-meta">{d.meta}</span>
              </button>
            ))}

            {others.length > 0 && <div className="sky-side-label">Threads</div>}
            {others.map((t) => (
              <button
                key={t.id}
                type="button"
                className="sky-thread"
                data-active={t.id === threadId}
                onClick={() => openThread(t.id)}
              >
                <span>{t.title ?? 'New chat'}</span>
                <span className="sky-meta" data-state={t.state}>
                  {t.state === 'new' ? '' : t.state}
                </span>
              </button>
            ))}

            {/* The way out of the day and into the files, at the foot of the list. */}
            <div className="sky-side-foot">
              <button type="button" className="sky-thread" onClick={() => navigate('/explorer')}>
                <span>Explorer</span>
              </button>
            </div>
          </>
        )}
      </nav>

      {explorerFile !== null ? (
        <DocView file={explorerFile} />
      ) : isAudition ? (
        <AuditionMain back={{ label: 'Talk', onClick: () => navigate('/voice') }} />
      ) : isVoice ? (
        <VoiceMain back={{ label: 'Today', onClick: () => navigate('/') }} />
      ) : threadId ? (
        <Fragment key={threadId}>
          <ChatMain
            chat={chat}
            title={threadTitle(chat.state.turns) ?? 'New chat'}
            back={{ label: 'Today', onClick: () => navigate('/') }}
            onEnd={endThread}
          />
        </Fragment>
      ) : (
        <DayView chat={chat} day={day} threads={isToday ? others : []} notes={notes} onOpen={openThread} />
      )}
    </div>
  )
}

function Shell() {
  const [view, setView] = useState<View>('today')

  return (
    <div className="sky-app">
      <Sidebar view={view} onNavigate={setView} />
      <div className="sky-main">
        <header className="sky-head">
          <span className="sky-title">{view === 'today' ? 'Friday, August 1' : 'Thursday, July 31 — the record'}</span>
          <nav className="sky-tabs">
            <Button size="sm">Chat</Button>
            <Button size="sm">Day file</Button>
            <Button size="sm">Docs</Button>
          </nav>
        </header>

        <div className="sky-scroll">{view === 'today' ? <TodayThread /> : <RecordView />}</div>

        <Composer />
      </div>
    </div>
  )
}

function Sidebar({ view, onNavigate }: { view: View; onNavigate: (view: View) => void }) {
  return (
    <nav className="sky-side">
      <div className="sky-side-top">
        <span className="sky-brand">sky</span>
        <SchemeToggle />
      </div>
      <Button className="sky-newchat" fullWidth justify="flex-start">
        ＋ New chat
      </Button>

      <div className="sky-side-label">Days</div>
      {DAYS.map((day) => (
        <button
          key={day.label}
          type="button"
          className="sky-thread"
          data-active={day.view === view}
          onClick={day.view ? () => onNavigate(day.view) : undefined}
        >
          <span>{day.label}</span>
          <span className="sky-meta">{day.meta}</span>
        </button>
      ))}

      <div className="sky-side-label">Horizons</div>
      {HORIZONS.map((item) => (
        <button key={item.label} type="button" className="sky-thread">
          <span>{item.label}</span>
          <span className="sky-meta">{item.meta}</span>
        </button>
      ))}

      <div className="sky-side-label">Threads</div>
      {TOPICS.map((item) => (
        <button key={item.label} type="button" className="sky-thread">
          <span>{item.label}</span>
          <span className="sky-meta">{item.meta}</span>
        </button>
      ))}
    </nav>
  )
}

function SchemeToggle() {
  const { colorScheme, toggleColorScheme } = useMantineColorScheme()
  return (
    <Button size="compact-sm" onClick={toggleColorScheme}>
      {colorScheme === 'dark' ? 'light' : 'dark'}
    </Button>
  )
}

function TodayThread() {
  return (
    <div className="sky-col">
      <div className="sky-condensed">— 6:31 voice ramble → filed as journal seed · raw transcript discarded —</div>

      <div className="sky-turn">
        <span className="sky-who">sky · 6:52</span>
        <div className="sky-body">
          <p>Morning. Two meetings today, nothing before 9:00. Journal first, as usual?</p>
          <div className="sky-actions">
            <Button color="green" disabled>
              ✓ Journaling
            </Button>
            <Button>Skip to brief</Button>
          </div>
        </div>
      </div>

      <JournalBlock />
      <BriefTurn />
      <TodayBlock />

      <div className="sky-turn sky-turn-user">
        <div className="sky-bubble">
          move teh report to after the sync — i want janes numbers in it. adn queue the quantum nudge
        </div>
        <span className="sky-fate">
          input is steam — this becomes “report → 10:30 · nudge queued” in the record, then evaporates
        </span>
      </div>

      <div className="sky-turn">
        <span className="sky-who">sky · 7:06</span>
        <div className="sky-body">
          <p>
            Done. Report moved to 10:30 with her numbers flagged as an input, and the Quantum Labs nudge goes out at
            9:05 unless you pull it.
          </p>
          <div className="sky-chips">
            <span className="sky-chip" data-act="true">
              day.md updated
            </span>
            <span className="sky-chip" data-act="true">
              send queued · 9:05
            </span>
            <span className="sky-chip">⌗ meeting · 07-28 atlas sync</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function JournalBlock() {
  return (
    <div className="sky-turn">
      <div className="sky-block">
        <div className="sky-block-head">
          Morning journal
          <span className="sky-spacer" />
          <span className="sky-mini">journal:new → 08-01/journal.md</span>
        </div>
        <div className="sky-block-pad">
          <p className="sky-q">What would make today feel won?</p>
          <p className="sky-quote">
            Atlas report out the door before the 9:00, and actually taking the walk instead of eating the slot.
          </p>

          <p className="sky-q">
            You wrote "the numbers kill the dithering" last night. Where else does that apply today?
          </p>
          <Textarea
            autosize
            minRows={3}
            defaultValue="Probably the retreat budget. If I put the real cost next to the"
            placeholder="Type, or just talk — this writes to the journal either way…"
          />
          <div className="sky-jfoot">
            <Button variant="light" color="blue">
              Next question
            </Button>
            <Button>Finish early</Button>
            <span className="sky-progress">2 of 3</span>
          </div>
        </div>
      </div>
    </div>
  )
}

const NEEDS = [
  {
    id: 'invoicing',
    text: 'Reply to Jane on annual invoicing — draft ready in your voice',
    sub: 'she pushed back Tuesday · flat-floor math attached',
    doneLabel: 'Sent',
  },
  {
    id: 'pricing',
    text: 'Pricing page copy — approve to publish',
    sub: "implements Wednesday's decision",
    doneLabel: 'Published',
  },
]

function BriefTurn() {
  const [approved, setApproved] = useState<Set<string>>(new Set())

  return (
    <div className="sky-turn">
      <span className="sky-who">sky · 7:04</span>
      <div className="sky-body">
        <p>Brief while you finish: three things need you, in order of leverage.</p>

        {NEEDS.map((need, index) => {
          const isApproved = approved.has(need.id)
          return (
            <div key={need.id} className="sky-need" data-approved={isApproved}>
              <span className="sky-need-n">{index + 1}</span>
              <span className="sky-need-txt">
                {need.text}
                <span className="sky-need-sub">{need.sub}</span>
              </span>
              {isApproved ? (
                <span className="sky-sent">{need.doneLabel}</span>
              ) : (
                <span className="sky-need-btns">
                  <Button
                    variant="light"
                    color="blue"
                    onClick={() => setApproved((prev) => new Set(prev).add(need.id))}
                  >
                    Approve
                  </Button>
                  <Button>Edit</Button>
                </span>
              )}
            </div>
          )
        })}

        <div className="sky-need">
          <span className="sky-need-n">3</span>
          <span className="sky-need-txt">
            Retreat dates — both holds expire Monday
            <span className="sky-need-sub">you flagged the spend; real cost comparison is ready when you are</span>
          </span>
          <span className="sky-need-btns">
            <Button>Talk it through</Button>
          </span>
        </div>

        <p style={{ marginTop: 15 }}>
          Schedule: <strong>9:00 Atlas sync</strong> (brief attached) and <strong>14:00 walk</strong> — day 44, I kept
          the slot clear. On radar, no action: Quantum Labs intro quiet 4 days; nudge drafted.
        </p>
      </div>
    </div>
  )
}

const TODOS = [
  { label: 'Finish Atlas report draft', tag: 'before 9:00', done: false },
  { label: 'Send invoicing reply', tag: '1 click', done: false },
  { label: 'Morning journal', tag: 'done', done: true },
  { label: 'Walk — keep the 14:00 slot', tag: 'streak 44', done: false },
]

function TodayBlock() {
  return (
    <div className="sky-turn">
      <div className="sky-block">
        <div className="sky-block-head">
          Today
          <span className="sky-spacer" />
          <span className="sky-mini">day:items → 08-01/day.md</span>
        </div>
        <div className="sky-block-pad">
          {TODOS.map((todo) => (
            <label key={todo.label} className="sky-todo" data-done={todo.done}>
              <Checkbox defaultChecked={todo.done} />
              <span className="sky-todo-label">{todo.label}</span>
              <span className="sky-tag">{todo.tag}</span>
            </label>
          ))}
          <div className="sky-week">▸ This week — 4 open, board deck due Friday</div>
        </div>
      </div>
    </div>
  )
}

function RecordView() {
  return (
    <div className="sky-col">
      <div className="sky-record">
        <h2 className="sky-rec-date">Thursday, July 31</h2>

        <p className="sky-rec-label">Happened</p>
        <div className="sky-rec-line">
          <span className="sky-rec-at">09:00</span>
          <span>Atlas sync — invoicing objection surfaced, math requested</span>
        </div>
        <div className="sky-rec-line">
          <span className="sky-rec-at">12:10</span>
          <span>Report structure reworked around usage tiers</span>
        </div>
        <div className="sky-rec-line">
          <span className="sky-rec-at">16:45</span>
          <span>Walk — day 43 kept</span>
        </div>

        <p className="sky-rec-label">Decided</p>
        <div className="sky-rec-line">
          <span className="sky-rec-at">⌗</span>
          <span>
            Bring flat-floor math to Jane rather than defending annual invoicing —{' '}
            <em>“the numbers kill the dithering”</em>
          </span>
        </div>

        <p className="sky-rec-label">Journal</p>
        <p className="sky-quote">
          Dithering is a data problem, not a courage problem. Every stalled decision this month un-stalled the moment
          the real numbers were on one page. Do that first, always.
        </p>

        <p className="sky-rec-label">Items</p>
        <div className="sky-rec-line">
          <span className="sky-rec-at">4/5</span>
          <span>done · “retreat dates” rolled to today</span>
        </div>

        <Button size="sm" style={{ marginTop: 18 }}>
          ▸ conversation behind this day — 23 turns, kept for provenance
        </Button>
      </div>
    </div>
  )
}

function Composer() {
  return (
    <div className="sky-composer-zone">
      <div className="sky-composer">
        <div className="sky-input">Message sky — talk, journal, capture, redirect…</div>
        <ActionIcon aria-label="Voice input">⏺</ActionIcon>
        <ActionIcon variant="light" color="blue" aria-label="Send">
          ↑
        </ActionIcon>
      </div>
      <div className="sky-under">
        <span>⌘K anything</span>
        <span>·</span>
        <span>answers cite your files</span>
        <span>·</span>
        <span>actions ask first</span>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
