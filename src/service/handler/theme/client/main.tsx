import '@mantine/core/styles.css'
import './shell.css'
import { Button, MantineProvider } from '@mantine/core'
import { Fragment, type MouseEvent, useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { AuditionMain } from './audition.tsx'
import { AutomationDetail, AutomationsMain, AutomationsSideNav, NewAutomation } from './automations.tsx'
import { ChatMain, threadTitle, useChat } from './chat.tsx'
import { ClockAmbient, ClockMain, useClockNow } from './clock.tsx'
import { DayView, useDay, useThreads } from './day.tsx'
import type { ChatCloseNotice } from './dayChatClose.tsx'
import { DayFilesMain, filesRouteOf } from './dayFiles.tsx'
import { DocView, explorerFileOf, fileHref, Tree } from './explorer.tsx'
import { type Kept, undoKeep } from './files.tsx'
import { ImportDialog, ImportMain, useFileDrop, useImportQueue, useImports } from './import.tsx'
import { OutboxMain } from './outbox.tsx'
import { SearchWorkspace } from './search.tsx'
import { RestartPending } from './serviceStatus.tsx'
import { SETTINGS_SECTIONS, settingsHref, SettingsMain, settingsSectionOf, useAppearanceBoot } from './settings.tsx'
import { usePromptDraftGuard } from './settingsPrompts.tsx'
import { SidebarIcon } from './sidebarIcon.tsx'
import { SidebarUtilities } from './sidebarUtilities.tsx'
import { StreaksMain } from './streaks.tsx'
import { skyTheme } from './theme.ts'
import { TrackingMain } from './tracking.tsx'
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
function useRoute(): [{ path: string; search: string }, (to: string) => void] {
  const readRoute = () => {
    if (window.location.pathname === '/voice') history.replaceState(null, '', `/thread/${crypto.randomUUID()}`)
    return { path: window.location.pathname, search: window.location.search }
  }
  const [route, setRoute] = useState(readRoute)
  useEffect(() => {
    const onPop = () => setRoute(readRoute())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const navigate = useCallback((to: string) => {
    history.pushState(null, '', to)
    setRoute({ path: window.location.pathname, search: window.location.search })
  }, [])
  return [route, navigate]
}

/**
 * The app. The day is the page; a thread is a page of its own that comes
 * back to the day.
 */
function Canvas() {
  const [{ path, search }, go] = useRoute()
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
  const isOutbox = path === '/outbox'
  const isTracking = path === '/tracking' || path.startsWith('/tracking/')
  const isStreaks = path === '/streaks' || path.startsWith('/streaks/')
  const isSearch = path === '/search'
  // '' is the explorer itself, a path is a file open in it, null is any other page.
  const explorerFile = explorerFileOf(path)
  const threads = useThreads()
  // Files dropped on the day: each one uploaded, confirmed, started — then its own page.
  const imports = useImports()
  // A saved/ended chat or a finished import changes the files behind the day's record.
  const dayRefreshKey = [
    path,
    ...threads.map((thread) => `${thread.id}:${thread.saved ?? ''}`).sort(),
    ...imports.map((job) => `${job.id}:${job.state}`).sort(),
  ].join('\u0000')
  const day = useDay(dayYmd, dayRefreshKey)
  const clock = useClockNow()
  // This week, for the sidebar: the day waiting to start, and whether next week has a plan.
  const { view: thisWeek, reload: reloadWeek } = useWeek('')
  const [chatNotices, setChatNotices] = useState<ChatCloseNotice[]>([])
  const dismissChatNotice = useCallback((id: string) => setChatNotices((prev) => prev.filter((n) => n.id !== id)), [])
  const importRows = imports.filter((j) => j.state !== 'cancelled')

  const chat = useChat(threadId ?? '')
  const currentChat = chat.state.id === threadId ? chat.state : null
  const chatTitle =
    currentChat?.title ??
    threads.find((thread) => thread.id === threadId)?.title ??
    (currentChat ? threadTitle(currentChat.turns, currentChat.inherited) : null) ??
    (currentChat?.parent ? 'New branch' : 'New chat')
  useEffect(() => {
    document.title = threadId
      ? `sky:chat - ${chatTitle}`
      : isAudition
        ? 'sky · audition'
        : isStreaks
          ? 'sky · streaks'
          : 'sky'
  }, [threadId, chatTitle, isAudition, isStreaks])
  const isToday = dayYmd === null
  const others = threads.filter((t) => !t.id.startsWith('day-'))
  const onDayPage =
    threadId === null &&
    importId === null &&
    !isAudition &&
    !isSettings &&
    !isClock &&
    !isAutomations &&
    !isOutbox &&
    !isTracking &&
    !isStreaks &&
    !isSearch &&
    !isWeek &&
    filesRoute === null &&
    explorerFile === null
  const showDateNav = onDayPage || isWeek || isStreaks || filesRoute !== null
  const activeDayYmd = filesRoute?.ymd ?? dayYmd
  const todayActive = isStreaks || (onDayPage && isToday) || (showDateNav && !isWeek && activeDayYmd === day?.today.ymd)
  const tomorrowYmd = day ? new PlainDate(day.today.ymd).addDays(1).ymd : null
  const tomorrowActive = showDateNav && !isWeek && tomorrowYmd !== null && activeDayYmd === tomorrowYmd

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
  // A saved chat opened to continue: the service makes (or finds) its thread, and the page turns to it.
  const openSaved = async (chat: string) => {
    const response = await fetch('/chat/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat }),
    }).catch(() => null)
    if (!response?.ok) return
    const body = (await response.json()) as { id: string }
    openThread(body.id)
  }
  const branchesOf = (id: string) => others.filter((t) => t.parent?.id === id)
  // Back to the day at once. The save — enrichment included — finishes behind
  // the Running block, then a temporary notification offers the details.
  const endThread = () => {
    const id = chat.state.id
    const title = chatTitle
    const saving = chat.end(chat.state.settings?.saves !== false)
    navigate('/')
    void saving.then((result) => {
      if (result) setChatNotices((prev) => [...prev.filter((n) => n.id !== id), { id, title, ...result }])
    })
  }
  // A link into the explorer — a row on the day, a link inside a document — turns the page in place.
  const onLinkClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const anchor = (event.target as Element).closest('a')
    if (!anchor?.href || anchor.target === '_blank' || anchor.hasAttribute('download')) return
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
        aria-label={menu ? 'Close' : 'Navigation'}
        aria-expanded={menu}
        onClick={() => setMenu((open) => !open)}
      >
        {menu ? '×' : '≡'}
        {!menu && thisWeek?.due && <span className="sky-menu-dot" />}
      </button>
      {menu && <div className="sky-scrim" onClick={() => setMenu(false)} />}
      <nav className="sky-side" data-open={menu}>
        <div className="sky-side-scroll">
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
            </>
          ) : (
            <>
              <button
                type="button"
                className="sky-thread sky-side-primary"
                data-active={todayActive}
                aria-current={todayActive ? 'page' : undefined}
                onClick={() => navigate('/')}
              >
                <SidebarIcon name="today" />
                <span>Today</span>
              </button>
              {showDateNav && (
                <div className="sky-side-dates">
                  {tomorrowYmd && (
                    <div className="sky-side-tomorrow">
                      <button
                        type="button"
                        className="sky-thread"
                        data-active={tomorrowActive}
                        aria-current={tomorrowActive ? 'page' : undefined}
                        onClick={() => navigate(`/${tomorrowYmd}`)}
                      >
                        <span>Tomorrow</span>
                        <time className="sky-meta" dateTime={tomorrowYmd} title={tomorrowYmd}>
                          {tomorrowYmd.slice(5)}
                        </time>
                      </button>
                    </div>
                  )}
                  <div className="sky-side-label">Past days</div>
                  {(day?.days ?? []).slice(1).map((d) => (
                    <button
                      key={d.ymd}
                      type="button"
                      className="sky-thread"
                      data-active={!isWeek && activeDayYmd === d.ymd}
                      aria-current={!isWeek && activeDayYmd === d.ymd ? 'page' : undefined}
                      onClick={() => navigate(`/${d.ymd}`)}
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
                    aria-current={isWeek && (weekId === '' || weekId === thisWeek?.id) ? 'page' : undefined}
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
                      aria-current={isWeek && weekId === thisWeek.next.id ? 'page' : undefined}
                      onClick={() => navigate(weekHref(thisWeek.next.id))}
                    >
                      <span>Next week</span>
                      <span className="sky-meta">{thisWeek.next.planned ? 'planned' : 'no plan yet'}</span>
                    </button>
                  )}
                </div>
              )}
              <button
                type="button"
                className="sky-thread sky-side-primary"
                data-active={threadId !== null}
                aria-current={threadId !== null ? 'page' : undefined}
                onClick={newChat}
              >
                <SidebarIcon name="chat" />
                <span>Chat</span>
              </button>
              <button
                type="button"
                className="sky-thread sky-side-primary sky-outbox-nav"
                data-active={isOutbox}
                aria-current={isOutbox ? 'page' : undefined}
                onClick={() => navigate('/outbox')}
              >
                <SidebarIcon name="outbox" />
                <span>Outbox</span>
              </button>
            </>
          )}
        </div>
        <div className="sky-side-foot">
          {isAutomations && (
            <Button className="sky-newchat" fullWidth justify="flex-start" onClick={() => navigate('/automations/new')}>
              ＋ New automation
            </Button>
          )}
          <SidebarUtilities
            active={isAutomations ? 'automations' : explorerFile !== null ? 'explorer' : isSettings ? 'settings' : null}
            navigate={navigate}
          />
        </div>
      </nav>

      <SearchWorkspace route={path + search} onNavigate={navigate}>
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
        ) : isOutbox ? (
          <OutboxMain navigate={navigate} />
        ) : isTracking ? (
          <TrackingMain path={path} navigate={navigate} />
        ) : isStreaks ? (
          <StreaksMain path={path} search={search} onNavigate={navigate} />
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
          <AuditionMain back={{ label: 'Chat', onClick: newChat }} />
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
              title={chatTitle}
              back={{ label: 'Today', onClick: () => navigate('/') }}
              onEnd={endThread}
              branches={[
                ...branchesOf(threadId).map((b) => ({ id: b.id, title: b.title, turn: b.parent?.turn ?? 0 })),
                // Filed beside this thread's file and not live: their marks open them as threads.
                ...chat.state.branches
                  .filter((b) => !others.some((t) => t.saved === b.chat))
                  .map((b) => ({ id: null, chat: b.chat, title: b.title, turn: b.turn })),
              ]}
              onBranched={openThread}
              onOpenSaved={(saved) => void openSaved(saved)}
            />
          </Fragment>
        ) : (
          <DayView
            trackingDate={dayYmd}
            navigate={navigate}
            day={day}
            threads={others}
            imports={isToday ? importRows : []}
            chatNotice={chatNotices[0]}
            onDismissChatNotice={dismissChatNotice}
            onOpen={openThread}
            onOpenSaved={(chat) => void openSaved(chat)}
            onOpenImport={openImport}
            onImportMeeting={queue.take}
            dragging={drop.dragging}
            onImportFiles={queue.take}
            kept={kept}
            onKept={setKept}
            onUndoKept={undoKept}
            onDismissKept={dismissKept}
          />
        )}
      </SearchWorkspace>
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
