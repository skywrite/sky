import '@mantine/core/styles.css'
import './shell.css'
import { Button, MantineProvider } from '@mantine/core'
import { Fragment, type MouseEvent, useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AuditionMain } from './audition.tsx'
import { AutomationDetail, AutomationsMain, AutomationsSideNav, NewAutomation } from './automations.tsx'
import { ChatMain, type Note, threadTitle, useChat } from './chat.tsx'
import { ClockAmbient, ClockMain, useClockNow } from './clock.tsx'
import { DayView, useDay, useThreads } from './day.tsx'
import { DayFilesMain, filesRouteOf } from './dayFiles.tsx'
import { DocView, explorerFileOf, fileHref, Tree } from './explorer.tsx'
import { type Kept, undoKeep } from './files.tsx'
import { acceptsImports, ImportDialog, ImportMain, useFileDrop, useImportQueue, useImports } from './import.tsx'
import { RestartPending } from './serviceStatus.tsx'
import { SETTINGS_SECTIONS, settingsHref, SettingsMain, settingsSectionOf, useAppearanceBoot } from './settings.tsx'
import { usePromptDraftGuard } from './settingsPrompts.tsx'
import { skyTheme } from './theme.ts'
import { VoiceMain } from './voice.tsx'
import { useWeek, weekHref, weekIdOf, WeekMain } from './week.tsx'

/**
 * The web app's client: React and Mantine on the sky theme, bundled by Bun on
 * request (see ../mod.ts). The path is the page — a day, a thread, an import,
 * a document in the explorer — and Canvas turns it into one.
 */

function App() {
  return (
    <MantineProvider theme={skyTheme} defaultColorScheme="light">
      <Canvas />
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
 * The app. The day is the page; a thread is a page of its own that comes
 * back to the day.
 */
function Canvas() {
  const [path, go] = useRoute()
  const [menu, setMenu] = useState(false)
  // The saved appearance — theme and text size — lands once, at start.
  useAppearanceBoot()
  usePromptDraftGuard()
  // On a phone the sidebar is a drawer; any navigation closes it.
  const navigate = (to: string) => {
    setMenu(false)
    go(to)
  }
  const threadId = path.match(/^\/thread\/([^/]+)/)?.[1] ?? null
  const importId = path.match(/^\/import\/([^/]+)/)?.[1] ?? null
  const dayYmd = path.match(/^\/(\d{4}-\d{2}-\d{2})$/)?.[1] ?? null
  // /<ymd>/files is the day's files, /<ymd>/files/<folder> a folder inside them.
  const filesRoute = filesRouteOf(path)
  const isVoice = path === '/voice'
  const isAudition = path === '/voice/audition'
  const settingsSection = settingsSectionOf(path)
  const isSettings = settingsSection !== null
  const isClock = path === '/clock'
  // /week is this week, /week/<id> another.
  const weekId = weekIdOf(path)
  const isWeek = weekId !== null
  // /automations is the overview, /automations/new the create flow,
  // /automations/<name> one charter's page.
  const isNewAutomation = path === '/automations/new'
  const automationName =
    path.startsWith('/automations/') && !isNewAutomation ? decodeURIComponent(path.slice('/automations/'.length)) : null
  const isAutomations = path === '/automations' || isNewAutomation || automationName !== null
  // '' is the explorer itself, a path is a file open in it, null is any other page.
  const explorerFile = explorerFileOf(path)
  const day = useDay(dayYmd)
  const clock = useClockNow()
  // This week, for the sidebar: the day waiting to start, and whether next week has a plan.
  const { view: thisWeek, reload: reloadWeek } = useWeek('')
  const threads = useThreads()
  const [notes, setNotes] = useState<Note[]>([])
  // Files dropped on the day: each one uploaded, confirmed, started — then its own page.
  const imports = useImports()
  const importRows = imports.filter((j) => j.state !== 'cancelled')

  // A day's own conversation is a thread whose id is the day; the day's rail lists the others.
  const dayThreadId = day ? `day-${day.day.ymd}` : ''
  const chat = useChat(threadId ?? dayThreadId)
  const isToday = dayYmd === null
  const others = threads.filter((t) => !t.id.startsWith('day-'))
  const onDayPage =
    threadId === null &&
    importId === null &&
    !isVoice &&
    !isAudition &&
    !isSettings &&
    !isClock &&
    !isAutomations &&
    !isWeek &&
    filesRoute === null &&
    explorerFile === null

  const openThread = (id: string) => navigate(`/thread/${id}`)
  const openImport = (id: string) => navigate(`/import/${id}`)
  // A file the rail's pad kept with the day: the toast holds Undo for a moment.
  const [kept, setKept] = useState<Kept[]>([])
  const queue = useImportQueue((job) => openImport(job.id))
  const drop = useFileDrop(onDayPage, queue.take)
  const undoKept = () => {
    const held = kept
    setKept([])
    if (held.length > 0) void undoKeep(held).catch(() => {})
  }
  const dismissKept = useCallback(() => setKept([]), [])
  const newChat = () => openThread(crypto.randomUUID())
  // Back to the day at once. The save — enrichment included — finishes behind
  // the Running block, and its note lands in the day when it does.
  const endThread = () => {
    const saving = chat.end(chat.state.settings?.saves !== false)
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
    if (url.origin !== location.origin) return
    if (!url.pathname.startsWith('/explorer/') && filesRouteOf(url.pathname) === null) return
    event.preventDefault()
    navigate(url.pathname)
  }

  return (
    <div className="sky-app" onClick={onLinkClick} {...drop.handlers}>
      <button
        type="button"
        className="sky-menu"
        aria-label={menu ? 'Close' : explorerFile !== null ? 'Files' : 'Days'}
        aria-expanded={menu}
        onClick={() => setMenu((open) => !open)}
      >
        {menu ? '×' : '≡'}
        {!menu && thisWeek?.due && <span className="sky-menu-dot" />}
      </button>
      {menu && <div className="sky-scrim" onClick={() => setMenu(false)} />}
      <nav className="sky-side" data-open={menu}>
        <div className="sky-side-top">
          <span className="sky-brand">sky</span>
          <ClockAmbient snap={clock} active={isClock} onOpen={() => navigate('/clock')} />
        </div>
        <RestartPending />
        {explorerFile !== null ? (
          <>
            <button type="button" className="sky-thread" onClick={() => navigate('/')}>
              <span>‹ Today</span>
            </button>
            <div className="sky-side-label">Explorer</div>
            <Tree file={explorerFile} onOpen={(file) => navigate(fileHref(file))} />
          </>
        ) : settingsSection ? (
          <>
            <button type="button" className="sky-thread" onClick={() => navigate('/')}>
              <span>‹ Today</span>
            </button>
            <div className="sky-side-label">Settings</div>
            {SETTINGS_SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                className="sky-thread"
                data-active={s.id === settingsSection}
                onClick={() => navigate(settingsHref(s.id))}
              >
                <span>{s.label}</span>
              </button>
            ))}
          </>
        ) : isAutomations ? (
          <>
            <button type="button" className="sky-thread" onClick={() => navigate('/')}>
              <span>‹ Today</span>
            </button>
            <div className="sky-side-label">Automations</div>
            <AutomationsSideNav
              overviewActive={automationName === null && !isNewAutomation}
              activeName={automationName}
              onOverview={() => navigate('/automations')}
              onOpen={(name) => navigate(`/automations/${encodeURIComponent(name)}`)}
            />
            <div className="sky-side-foot">
              <Button
                className="sky-newchat"
                fullWidth
                justify="flex-start"
                onClick={() => navigate('/automations/new')}
              >
                ＋ New automation
              </Button>
            </div>
          </>
        ) : (
          <>
            <Button className="sky-newchat" fullWidth variant="default" onClick={newChat}>
              New chat
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
                data-active={
                  threadId === null &&
                  importId === null &&
                  !isVoice &&
                  !isSettings &&
                  !isClock &&
                  !isAutomations &&
                  !isWeek &&
                  (offset === 0 ? isToday : dayYmd === d.ymd)
                }
                onClick={() => navigate(offset === 0 ? '/' : `/${d.ymd}`)}
              >
                <span>{d.label}</span>
                <time className="sky-meta" dateTime={d.ymd} title={d.ymd}>
                  {d.ymd.slice(5)}
                </time>
              </button>
            ))}

            {/* The two horizons: this week, with the day waiting to start, and the next. */}
            <div className="sky-side-label">Week</div>
            <button
              type="button"
              className="sky-thread"
              data-active={isWeek && (weekId === '' || weekId === thisWeek?.id)}
              onClick={() => navigate('/week')}
            >
              <span>
                This week
                {thisWeek?.due && <span className="sky-wdot" />}
              </span>
              <span className="sky-meta">
                {thisWeek?.due ? `${thisWeek.due.weekday} not started` : thisWeek ? thisWeek.id.slice(5) : ''}
              </span>
            </button>
            {thisWeek && (
              <button
                type="button"
                className="sky-thread"
                data-active={isWeek && weekId === thisWeek.next.id}
                onClick={() => navigate(weekHref(thisWeek.next.id))}
              >
                <span>Next week</span>
                <span className="sky-meta">{thisWeek.next.planned ? 'planned' : 'no plan yet'}</span>
              </button>
            )}

            {/* The way out of the day and into the files, at the foot of the list. */}
            <div className="sky-side-foot">
              <button type="button" className="sky-thread" onClick={() => navigate('/automations')}>
                <span>Automations</span>
              </button>
              <button type="button" className="sky-thread" onClick={() => navigate('/explorer')}>
                <span>Explorer</span>
              </button>
              <button
                type="button"
                className="sky-thread"
                data-active={isSettings}
                onClick={() => navigate('/settings')}
              >
                <span>Settings</span>
              </button>
            </div>
          </>
        )}
      </nav>

      {explorerFile !== null ? (
        <DocView file={explorerFile} />
      ) : filesRoute ? (
        <DayFilesMain ymd={filesRoute.ymd} folder={filesRoute.folder} go={navigate} />
      ) : isWeek ? (
        <WeekMain
          id={weekId}
          onOpenDay={(ymd, today) => navigate(today ? '/' : `/${ymd}`)}
          onOpenWeek={(id) => navigate(weekHref(id))}
          onChanged={reloadWeek}
        />
      ) : isClock ? (
        <ClockMain back={{ label: 'Today', onClick: () => navigate('/') }} snap={clock} />
      ) : isNewAutomation ? (
        <NewAutomation
          back={{ label: 'Automations', onClick: () => navigate('/automations') }}
          onCreated={(name) => navigate(`/automations/${encodeURIComponent(name)}`)}
        />
      ) : automationName ? (
        <AutomationDetail
          name={automationName}
          back={{ label: 'Automations', onClick: () => navigate('/automations') }}
        />
      ) : isAutomations ? (
        <AutomationsMain
          back={{ label: 'Today', onClick: () => navigate('/') }}
          onOpen={(name) => navigate(`/automations/${encodeURIComponent(name)}`)}
          onNew={() => navigate('/automations/new')}
        />
      ) : settingsSection ? (
        <SettingsMain
          section={settingsSection}
          path={path}
          navigate={navigate}
          back={{ label: 'Today', onClick: () => navigate('/') }}
        />
      ) : isAudition ? (
        <AuditionMain back={{ label: 'Talk', onClick: () => navigate('/voice') }} />
      ) : isVoice ? (
        <VoiceMain back={{ label: 'Today', onClick: () => navigate('/') }} />
      ) : importId ? (
        <Fragment key={importId}>
          <ImportMain
            id={importId}
            back={{ label: 'Today', onClick: () => navigate('/') }}
            onStartAgain={queue.startAgain}
          />
        </Fragment>
      ) : threadId ? (
        <Fragment key={threadId}>
          <ChatMain
            chat={chat}
            title={threads.find((t) => t.id === threadId)?.title ?? threadTitle(chat.state.turns) ?? 'New chat'}
            back={{ label: 'Today', onClick: () => navigate('/') }}
            onEnd={endThread}
          />
        </Fragment>
      ) : (
        <DayView
          chat={chat}
          day={day}
          threads={others}
          imports={isToday ? importRows : []}
          notes={notes}
          onOpen={openThread}
          onOpenImport={openImport}
          onImportMeeting={queue.take}
          dragging={drop.dragging}
          attach={{ accept: acceptsImports(), onFiles: queue.take }}
          kept={kept}
          onKept={setKept}
          onUndoKept={undoKept}
          onDismissKept={dismissKept}
        />
      )}
      <ImportDialog
        pending={queue.pending}
        again={queue.again}
        todayYmd={day?.today.ymd ?? null}
        onStarted={queue.onStarted}
        onDismiss={queue.onDismiss}
      />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
