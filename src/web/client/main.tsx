import '@mantine/core/styles.css'
import './shell/shell.css'
import { Button, MantineProvider } from '@mantine/core'
import { Fragment, type MouseEvent, useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { isAttachmentNote } from '#commands/all/notes/lib/documentInput.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { type Kept, undoKeep } from './attachments/files.tsx'
import { AutomationDetail, AutomationsMain, AutomationsSideNav, NewAutomation } from './automations/automations.tsx'
import { ChatMain, threadTitle, useChat } from './chat/chat.tsx'
import { LiveChats } from './chat/LiveChats.tsx'
import { SidebarChats } from './chat/SidebarChats.tsx'
import { sidebarChatRows } from './chat/sidebarRows.ts'
import { ClockAmbient, ClockMain, clockChanged, useClockNow } from './clock/clock.tsx'
import { DayView, threadsChanged, useThreads } from './day/day.tsx'
import type { ChatCloseNotice } from './day/dayChatClose.tsx'
import { DayFilesMain, filesRouteOf, shortLabel } from './day/dayFiles.tsx'
import { useItemHelpChat } from './day/dayItemHelp.tsx'
import { DayReviewDialog, useReviewPrompt } from './day/review/dayReview.tsx'
import { useDay } from './day/useDay.ts'
import { DocView, explorerFileOf, fileHref, Tree } from './explorer/explorer.tsx'
import { RemovedToast } from './explorer/explorerDelete.tsx'
import { ExtensionNavLinks, ExtensionPageMain, extensionRouteOf } from './extensions/extensions.tsx'
import { FutureMain } from './future/FutureMain.tsx'
import { futureRouteOf } from './future/routes.ts'
import { useDocumentNotices } from './import/documentImport.tsx'
import { ImportDialog, ImportMain, ImportsWaiting, useFileDrop, useImportQueue, useImports } from './import/import.tsx'
import { JournalMain } from './journal/journal.tsx'
import { journalRouteOf } from './journal/journalRoutes.ts'
import { useFileRemoval } from './lib/useFileRemoval.ts'
import { MeetingMain, meetingRouteOf } from './meetings/meetingPage.tsx'
import { NoteMain } from './notes/NoteMain.tsx'
import { noteRouteOf } from './notes/noteRoute.ts'
import { OutboxMain } from './outbox/outbox.tsx'
import { outboxItemOf, outboxLegacyItemPath } from './outbox/outboxRoutes.ts'
import { PeopleMain, peopleRouteOf } from './people/people.tsx'
import { PlacesMain, placesRouteOf } from './places/places.tsx'
import { RecurringMain } from './recurring/RecurringMain.tsx'
import { ResponseScoreMain } from './responseScore/ResponseScoreMain.tsx'
import { isResponseScorePath } from './responseScore/routes.ts'
import { SchedulePage } from './schedule/SchedulePage.tsx'
import { openSearch, SearchWorkspace } from './search/search.tsx'
import { SettingsMain, useSettingsBoot } from './settings/settings.tsx'
import { useAboutMeDraftGuard } from './settings/settingsAboutMe.tsx'
import { SettingsHome } from './settings/SettingsHome.tsx'
import { SettingsNav } from './settings/settingsNav.tsx'
import { usePromptDraftGuard } from './settings/settingsPrompts.tsx'
import {
  CONNECTION_PAGE_LABEL,
  connectionPageOf,
  SETTINGS_PAGES,
  settingsSectionOf,
} from './settings/settingsRoutes.ts'
import { type BarTab, BottomBar } from './shell/BottomBar.tsx'
import { DayNav } from './shell/DayNav.tsx'
import { DaysSheet } from './shell/DaysSheet.tsx'
import { type MoreDestination, MorePanel } from './shell/MorePanel.tsx'
import { RestartPending } from './shell/serviceStatus.tsx'
import { SidebarIcon } from './shell/sidebarIcon.tsx'
import { SidebarUtilities } from './shell/sidebarUtilities.tsx'
import { skyTheme } from './shell/theme.ts'
import { useNarrowLayout } from './shell/useNarrowLayout.ts'
import { StreaksMain } from './streaks/streaks.tsx'
import { TrackingMain } from './tracking/tracking.tsx'
import { AuditionMain } from './voice/audition.tsx'
import { useWeek, weekHref, weekIdOf, WeekMain } from './week/week.tsx'
import { isWhiteboardPath } from './whiteboard/routes.ts'
import { WhiteboardMain } from './whiteboard/WhiteboardMain.tsx'
import { WorkstreamsMain } from './workstreams/WorkstreamsMain.tsx'

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
function useRoute(): [{ path: string; search: string }, (to: string, replace?: boolean) => void] {
  const readRoute = () => {
    if (window.location.pathname === '/voice') history.replaceState(null, '', `/thread/${crypto.randomUUID()}`)
    const legacyOutboxItem = outboxLegacyItemPath(window.location.pathname, window.location.search)
    if (legacyOutboxItem) history.replaceState(null, '', legacyOutboxItem)
    return { path: window.location.pathname, search: window.location.search }
  }
  const [route, setRoute] = useState(readRoute)
  useEffect(() => {
    const onPop = () => setRoute(readRoute())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const navigate = useCallback((to: string, replace = false) => {
    if (replace) history.replaceState(null, '', to)
    else history.pushState(null, '', to)
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
  const narrow = useNarrowLayout()
  // The narrow layout's More panel, and the days sheet a day's date opens there.
  const [more, setMore] = useState(false)
  const [daysOpen, setDaysOpen] = useState(false)
  const reviewParam = new URLSearchParams(search).get('review')
  const reviewDay = reviewParam && /^\d{4}-\d{2}-\d{2}$/.test(reviewParam) ? reviewParam : null
  const openReview = (day: string, replace = false) => {
    const query = new URLSearchParams(search)
    query.set('review', day)
    go(`${path}?${query}`, replace)
  }
  const closeReview = () => {
    const query = new URLSearchParams(search)
    query.delete('review')
    go(`${path}${query.size ? `?${query}` : ''}`, true)
  }
  // The address holds a review the person opened or acted in; until then the prompt shows it in every tab.
  const [promptDay, dismissPrompt] = useReviewPrompt()
  const shownReview = reviewDay ?? promptDay
  const sidebarExperiments = useSettingsBoot()
  usePromptDraftGuard()
  useAboutMeDraftGuard()
  // Going anywhere closes the phone's More panel and its days sheet.
  const navigate = (to: string, replace = false) => {
    setMore(false)
    setDaysOpen(false)
    go(to, replace)
  }
  const removal = useFileRemoval(navigate)
  const threadId = path.match(/^\/thread\/([^/]+)/)?.[1] ?? null
  const importId = path.match(/^\/import\/([^/]+)/)?.[1] ?? null
  const dayYmd = path.match(/^\/(\d{4}-\d{2}-\d{2})$/)?.[1] ?? null
  // /<ymd>/files is the day's files, /<ymd>/files/<folder> a folder inside them.
  const filesRoute = filesRouteOf(path)
  const journalRoute = journalRouteOf(path)
  // /<ymd>/meetings/<slug> is a meeting's page, under its day.
  const meetingRoute = meetingRouteOf(path)
  // /<ymd>/notes/<name> is a note written on the day, /<ymd>/notes/new a blank one.
  const noteRoute = noteRouteOf(path)
  const isAudition = path === '/voice/audition'
  const settingsSection = settingsSectionOf(path)
  const connectionPage = settingsSection === 'connections' ? connectionPageOf(path) : null
  const isSettings = settingsSection !== null
  // A phone's /settings lists every section; a wide screen shows Appearance beside the sidebar's list.
  const settingsHome = narrow && (path === '/settings' || path === '/settings/')
  const peopleRoute = peopleRouteOf(path)
  const placesRoute = placesRouteOf(path)
  const isRecurring = path === '/recurring'
  // /extensions/<author>/<slug> is an extension's own page.
  const extensionPage = extensionRouteOf(path)
  const isClock = path === '/clock'
  const isSchedule = path === '/schedule'
  // /week is this week, /week/<id> another.
  const weekId = weekIdOf(path)
  const isWeek = weekId !== null
  // /automations is the overview, /automations/new the create flow,
  // /automations/<name> one charter's page.
  const isNewAutomation = path === '/automations/new'
  const automationName =
    path.startsWith('/automations/') && !isNewAutomation ? decodeURIComponent(path.slice('/automations/'.length)) : null
  const isAutomations = path === '/automations' || isNewAutomation || automationName !== null
  // '' is the outbox list, an id one item's page, null any other page.
  const outboxItem = outboxItemOf(path)
  const isOutbox = outboxItem !== null
  // /future is the goals being pursued, /future/goals/<name> one goal's page.
  const futureRoute = futureRouteOf(path)
  const isFuture = futureRoute !== null
  const isTracking = path === '/tracking' || path.startsWith('/tracking/')
  const isStreaks = path === '/streaks' || path.startsWith('/streaks/')
  const isResponseScore = isResponseScorePath(path)
  const isSearch = path === '/search'
  const isWhiteboard = isWhiteboardPath(path)
  const isWorkstreams = path === '/workstreams' || path.startsWith('/workstreams/')
  const workstreamId = path.startsWith('/workstreams/') ? decodeURIComponent(path.slice('/workstreams/'.length)) : null
  // '' is the explorer itself, a path is a file open in it, null is any other page.
  const explorerFile = explorerFileOf(path)
  const threads = useThreads()
  const { imports, started: importStarted } = useImports()
  const documentNotices = useDocumentNotices(imports)
  // A day started from its page moves today: the day is read again even on the same path.
  const [dayStarts, setDayStarts] = useState(0)
  // A saved/ended chat or a finished import changes the files behind the day's record.
  const dayRefreshKey = [
    path,
    String(dayStarts),
    ...threads.map((thread) => `${thread.id}:${thread.saved ?? ''}`).sort(),
    ...imports
      .map(
        (job) =>
          `${job.id}:${job.state}:${isAttachmentNote(job.readback.source, job.fields?.kind) ? (job.stage?.id ?? '') : ''}`,
      )
      .sort(),
  ].join('\u0000')
  const { day, applyView: applyDayView } = useDay(dayYmd, dayRefreshKey)
  const clock = useClockNow()
  // This week, for the sidebar: the day waiting to start, and whether next week has a plan.
  const { view: thisWeek, reload: reloadWeek } = useWeek('')
  // A day started or reviewed from a page: the week's dot, the clock, and today all follow.
  const dayChanged = () => {
    setDayStarts((count) => count + 1)
    reloadWeek()
    clockChanged()
  }
  const [chatNotices, setChatNotices] = useState<ChatCloseNotice[]>([])
  const dismissChatNotice = useCallback((id: string) => setChatNotices((prev) => prev.filter((n) => n.id !== id)), [])
  const importRows = imports.filter((j) => j.state !== 'cancelled')
  // An import waiting on the person shows in the sidebar on every page but its own.
  const waitingImports = importRows.filter((job) => job.state === 'needs-you' && job.id !== importId)

  const chat = useChat(threadId ?? '')
  const currentChat = chat.state.id === threadId ? chat.state : null
  useEffect(() => {
    if (!threadId) return
    threadsChanged()
  }, [
    threadId,
    currentChat?.phase,
    currentChat?.turns.length,
    currentChat?.approvals.length,
    currentChat?.settings?.saves,
    currentChat?.gather,
  ])
  const chatTitle =
    currentChat?.title ??
    threads.find((thread) => thread.id === threadId)?.title ??
    (currentChat ? threadTitle(currentChat.turns, currentChat.inherited) : null) ??
    (currentChat?.parent ? 'New branch' : 'New chat')
  // Return to the day the conversation was opened from; filing stays anchored to its original day.
  const chatDay = currentChat?.day ?? threads.find((thread) => thread.id === threadId)?.day ?? null
  const requestedReturn = new URLSearchParams(search).get('returnTo')
  // A chat opened from a phone's Chat page goes back there: a new chat, which lists the live ones.
  const fromChatList = requestedReturn === 'chat'
  const returnTo =
    requestedReturn && /^\/(?:\d{4}-\d{2}-\d{2})?(?:\?review=\d{4}-\d{2}-\d{2})?$/.test(requestedReturn)
      ? requestedReturn
      : null
  const chatHome: { path: string | null; label: string } = fromChatList
    ? { path: null, label: 'Chat' }
    : returnTo
      ? {
          path: returnTo,
          label: returnTo.includes('?review=')
            ? 'Day review'
            : returnTo === '/'
              ? 'Today'
              : shortLabel(returnTo.slice(1)),
        }
      : chatDay && day && chatDay !== day.today.ymd
        ? { path: `/${chatDay}`, label: shortLabel(chatDay) }
        : { path: '/', label: 'Today' }
  const onDayPage =
    threadId === null &&
    importId === null &&
    !isAudition &&
    !isSettings &&
    !peopleRoute &&
    placesRoute === null &&
    !isRecurring &&
    extensionPage === null &&
    !isClock &&
    !isSchedule &&
    !isAutomations &&
    !isOutbox &&
    !isFuture &&
    !isTracking &&
    !isStreaks &&
    !isResponseScore &&
    !isSearch &&
    !isWhiteboard &&
    !isWorkstreams &&
    !isWeek &&
    filesRoute === null &&
    meetingRoute === null &&
    noteRoute === null &&
    journalRoute === null &&
    explorerFile === null
  const weekTitle = weekId || thisWeek?.id
  useEffect(() => {
    // These screens set their own titles from the content they display.
    if (
      settingsSection === 'models' ||
      journalRoute ||
      meetingRoute ||
      noteRoute ||
      onDayPage ||
      isSchedule ||
      isOutbox ||
      peopleRoute ||
      placesRoute !== null ||
      isRecurring ||
      isFuture ||
      isTracking ||
      isStreaks ||
      isResponseScore ||
      isWhiteboard ||
      importId ||
      explorerFile !== null
    )
      return
    document.title = isWeek
      ? `sky · ${weekTitle ? `Week ${weekTitle}` : 'This week'}`
      : threadId
        ? `sky:chat - ${chatTitle}`
        : isAudition
          ? 'sky · audition'
          : settingsHome
            ? 'sky · Settings'
            : settingsSection === 'connections'
              ? `sky · ${connectionPage ? CONNECTION_PAGE_LABEL[connectionPage] : 'Connections'}`
              : settingsSection
                ? `sky · ${SETTINGS_PAGES[settingsSection].label}`
                : isClock
                  ? 'sky · Clock'
                  : 'sky'
  }, [
    settingsHome,
    threadId,
    chatTitle,
    connectionPage,
    isClock,
    isSchedule,
    isAudition,
    isStreaks,
    isResponseScore,
    isOutbox,
    peopleRoute,
    placesRoute,
    isRecurring,
    isFuture,
    isTracking,
    isWhiteboard,
    importId,
    explorerFile,
    onDayPage,
    journalRoute?.day,
    journalRoute?.topic,
    meetingRoute?.ymd,
    meetingRoute?.slug,
    noteRoute?.ymd,
    noteRoute?.slug,
    isWeek,
    weekTitle,
    settingsSection,
  ])
  // Today's page at its own date is today too: its rail shows the imports in hand.
  const isToday = dayYmd === null || dayYmd === day?.today.ymd
  const others = threads.filter((t) => !t.id.startsWith('day-'))
  const showDateNav =
    journalRoute !== null ||
    onDayPage ||
    isWeek ||
    isStreaks ||
    isResponseScore ||
    filesRoute !== null ||
    meetingRoute !== null ||
    noteRoute !== null
  const activeDayYmd = journalRoute?.day ?? filesRoute?.ymd ?? meetingRoute?.ymd ?? noteRoute?.ymd ?? dayYmd
  // Another day keeps its own meeting imports too, so each meeting's row can show its import.
  const dayImports = importRows.filter((job) =>
    isAttachmentNote(job.readback.source, job.fields?.kind) || job.readback.source === 'imessage-audio'
      ? (job.fields?.when ?? job.suggestedWhen).slice(0, 10) === (activeDayYmd ?? day?.today.ymd)
      : isToday || (job.fields?.kind === 'meeting' && job.fields.when.slice(0, 10) === activeDayYmd),
  )
  const todayActive =
    isStreaks ||
    isResponseScore ||
    (onDayPage && isToday) ||
    (showDateNav && !isWeek && activeDayYmd === day?.today.ymd)
  const tomorrowYmd = day ? new PlainDate(day.today.ymd).addDays(1).ymd : null
  const tomorrowActive = showDateNav && !isWeek && tomorrowYmd !== null && activeDayYmd === tomorrowYmd
  // Tomorrow, the past days and the two weeks: under Today in the sidebar, and in a phone's days sheet.
  const dayNav = {
    tomorrowYmd,
    tomorrowActive,
    days: (day?.days ?? []).slice(1),
    activeDayYmd,
    isWeek,
    weekId,
    thisWeek,
    navigate,
  }
  // The narrow layout's bar marks where the page belongs: Chat, Future, a page behind More, or Today's world.
  const moreActive: MoreDestination | null = isOutbox
    ? 'outbox'
    : isWorkstreams
      ? 'workstreams'
      : isWhiteboard
        ? 'whiteboard'
        : isAutomations
          ? 'automations'
          : explorerFile !== null
            ? 'explorer'
            : peopleRoute
              ? 'people'
              : placesRoute !== null
                ? 'places'
                : isRecurring
                  ? 'recurring'
                  : isSettings
                    ? 'settings'
                    : null
  const barTab: BarTab | null =
    threadId !== null || isAudition
      ? 'chat'
      : isFuture
        ? 'future'
        : moreActive !== null || extensionPage !== null || isClock
          ? 'more'
          : isSearch
            ? null
            : 'today'
  // A phone's Chat page lists the live chats above its message box.
  const liveRows =
    narrow && threadId !== null
      ? sidebarChatRows(
          others.filter((thread) => thread.id !== threadId),
          day?.today.ymd ?? null,
        )
      : []

  const threadHref = (id: string) => {
    const destination = onDayPage ? (day?.day.ymd === day?.today.ymd ? '/' : path) : fromChatList ? 'chat' : returnTo
    return `/thread/${encodeURIComponent(id)}${destination ? `?returnTo=${encodeURIComponent(destination)}` : ''}`
  }
  const chatListHref = (id: string) => `/thread/${encodeURIComponent(id)}?returnTo=chat`
  const openThread = (id: string) => navigate(threadHref(id))
  const helpWithItem = useItemHelpChat(path, openThread)
  const openImport = (id: string) => navigate(`/import/${id}`)
  // A file the rail's pad kept with the day: the toast holds Undo for a moment.
  const [kept, setKept] = useState<Kept[]>([])
  const [importGeneration, setImportGeneration] = useState(0)
  const queue = useImportQueue(
    (job) => {
      importStarted(job)
      documentNotices.started(job)
      setImportGeneration((generation) => generation + 1)
      if (!isAttachmentNote(job.readback.source, job.fields?.kind)) openImport(job.id)
      else {
        const targetDay = job.fields?.when.slice(0, 10)
        if ((onDayPage || filesRoute) && targetDay && targetDay !== (activeDayYmd ?? day?.today.ymd))
          navigate(`/${targetDay}`)
      }
    },
    activeDayYmd ?? day?.today.ymd,
    // The file is importing already: its import, which says why it opened in place of a new one.
    (job) => navigate(`/import/${job.id}?dropped`),
  )
  const drop = useFileDrop(onDayPage, queue.take, queue.takeText)
  const undoKept = () => {
    const held = kept
    setKept([])
    if (held.length > 0) void undoKeep(held).catch(() => {})
  }
  const dismissKept = useCallback(() => setKept([]), [])
  const newChat = () => openThread(crypto.randomUUID())
  const goChatHome = () => (chatHome.path === null ? newChat() : navigate(chatHome.path))
  // A saved chat opened to continue: the service makes (or finds) its thread, and the page turns to it —
  // or, given a tab opened for it, that tab does.
  const openSaved = async (chat: string, tab: Window | null = null) => {
    const response = await fetch('/chat/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat }),
    }).catch(() => null)
    if (!response?.ok) {
      tab?.close()
      return
    }
    const body = (await response.json()) as { id: string }
    if (tab) tab.location.href = threadHref(body.id)
    else openThread(body.id)
  }
  const branchesOf = (id: string) => others.filter((t) => t.parent?.id === id)
  // Back to the day at once. The save — enrichment included — finishes behind
  // the Running block, then a temporary notification offers the details.
  const endThread = () => {
    const id = chat.state.id
    const title = chatTitle
    const saving = chat.end(chat.state.settings?.saves !== false)
    goChatHome()
    void saving.then((result) => {
      threadsChanged()
      if (result) setChatNotices((prev) => [...prev.filter((n) => n.id !== id), { id, title, ...result }])
    })
  }
  // Ordinary clicks on internal document and chat links turn the page in place.
  const onLinkClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const anchor = (event.target as Element).closest('a')
    if (!anchor?.href || anchor.target === '_blank' || anchor.hasAttribute('download')) return
    const url = new URL(anchor.href)
    if (url.origin !== location.origin) return
    if (url.hash && url.pathname === location.pathname && url.search === location.search) return
    if (
      !url.pathname.startsWith('/thread/') &&
      !url.pathname.startsWith('/explorer/') &&
      !isWhiteboardPath(url.pathname) &&
      filesRouteOf(url.pathname) === null &&
      meetingRouteOf(url.pathname) === null &&
      noteRouteOf(url.pathname) === null &&
      journalRouteOf(url.pathname) === null
    )
      return
    event.preventDefault()
    navigate(url.pathname + url.search + url.hash)
  }

  return (
    <div className="sky-app" onClick={onLinkClick} {...drop.handlers}>
      <nav className="sky-side">
        <div className="sky-side-scroll">
          <div className="sky-side-top">
            <span className="sky-brand">sky</span>
            <ClockAmbient snap={clock} active={isClock} onOpen={() => navigate('/clock')} />
          </div>
          <RestartPending />
          <ImportsWaiting jobs={waitingImports} onOpen={openImport} />
          {explorerFile !== null ? (
            <>
              <button type="button" className="sky-thread" onClick={() => navigate('/')}>
                <span>‹ Today</span>
              </button>
              <div className="sky-side-label">Explorer</div>
              <Tree file={explorerFile} onOpen={(file) => navigate(fileHref(file))} />
            </>
          ) : settingsSection || peopleRoute || placesRoute !== null || isRecurring || extensionPage !== null ? (
            <>
              <button type="button" className="sky-thread" onClick={() => navigate('/')}>
                <span>‹ Today</span>
              </button>
              <a
                href="/people"
                className="sky-thread sky-settings-link sky-people-nav"
                data-active={Boolean(peopleRoute)}
                aria-current={peopleRoute ? 'page' : undefined}
                onClick={(event) => {
                  if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
                  event.preventDefault()
                  navigate('/people')
                }}
              >
                People &amp; Orgs
              </a>
              <a
                href="/places"
                className="sky-thread sky-settings-link"
                data-active={placesRoute !== null}
                aria-current={placesRoute !== null ? 'page' : undefined}
                onClick={(event) => {
                  if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
                  event.preventDefault()
                  navigate('/places')
                }}
              >
                Places
              </a>
              <a
                href="/recurring"
                className="sky-thread sky-settings-link"
                data-active={isRecurring}
                aria-current={isRecurring ? 'page' : undefined}
                onClick={(event) => {
                  if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
                  event.preventDefault()
                  navigate('/recurring')
                }}
              >
                Recurring
              </a>
              <ExtensionNavLinks active={extensionPage} navigate={navigate} />
              <div className="sky-side-label">Settings</div>
              <SettingsNav section={settingsSection} navigate={navigate} />
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
              {showDateNav && <DayNav {...dayNav} />}
              <button
                type="button"
                className="sky-thread sky-side-primary"
                data-active={isFuture}
                aria-current={isFuture ? 'page' : undefined}
                onClick={() => navigate('/future')}
              >
                <SidebarIcon name="future" />
                <span>Future</span>
              </button>
              <SidebarChats
                threads={others}
                activeThreadId={threadId}
                todayYmd={day?.today.ymd ?? null}
                hrefOf={threadHref}
                onNewChat={newChat}
              />
              {sidebarExperiments.outbox && (
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
              )}
              {sidebarExperiments.workstreams && (
                <button
                  type="button"
                  className="sky-thread sky-side-primary"
                  data-active={isWorkstreams}
                  aria-current={isWorkstreams ? 'page' : undefined}
                  onClick={() => navigate('/workstreams')}
                >
                  <SidebarIcon name="workstreams" />
                  <span>Workstreams</span>
                </button>
              )}
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
            active={
              isWhiteboard
                ? 'whiteboard'
                : isAutomations
                  ? 'automations'
                  : explorerFile !== null
                    ? 'explorer'
                    : isSettings || peopleRoute || placesRoute !== null || isRecurring
                      ? 'settings'
                      : null
            }
            navigate={navigate}
          />
        </div>
      </nav>

      <SearchWorkspace route={path + search} onNavigate={navigate}>
        {explorerFile !== null ? (
          <DocView
            file={explorerFile}
            go={navigate}
            removal={removal}
            edit={new URLSearchParams(search).has('edit')}
            onImportConversation={queue.takeConversation}
          />
        ) : journalRoute ? (
          <Fragment key={journalRoute.day}>
            <JournalMain route={journalRoute} search={search} navigate={navigate} />
          </Fragment>
        ) : noteRoute ? (
          <NoteMain ymd={noteRoute.ymd} slug={noteRoute.slug} go={navigate} />
        ) : meetingRoute ? (
          <MeetingMain ymd={meetingRoute.ymd} slug={meetingRoute.slug} go={navigate} removal={removal} />
        ) : filesRoute ? (
          <DayFilesMain
            ymd={filesRoute.ymd}
            folder={filesRoute.folder}
            go={navigate}
            onCreateNote={queue.takeExisting}
            importNotice={documentNotices.notice}
            onDismissImportNotice={documentNotices.dismiss}
            importDialogOpen={Boolean(queue.pending || queue.again)}
            onOpenImport={openImport}
          />
        ) : isWeek ? (
          <Fragment key={weekId}>
            <WeekMain
              id={weekId}
              onOpenDay={(ymd, today) => navigate(today ? '/' : `/${ymd}`)}
              onOpenWeek={(id) => navigate(weekHref(id))}
              onReview={(ymd) => navigate(`/${ymd}?review=${ymd}`)}
              onChanged={dayChanged}
            />
          </Fragment>
        ) : isClock ? (
          <ClockMain
            back={{ label: 'Today', onClick: () => navigate('/') }}
            snap={clock}
            onSchedule={() => navigate('/schedule')}
          />
        ) : isSchedule ? (
          <SchedulePage find={new URLSearchParams(search).get('tab') === 'find'} navigate={navigate} />
        ) : isOutbox ? (
          <OutboxMain item={outboxItem ?? ''} navigate={navigate} />
        ) : futureRoute ? (
          <FutureMain route={futureRoute} navigate={navigate} />
        ) : isTracking ? (
          <TrackingMain path={path} navigate={navigate} />
        ) : isStreaks ? (
          <StreaksMain path={path} search={search} onNavigate={navigate} />
        ) : isResponseScore ? (
          <ResponseScoreMain navigate={navigate} />
        ) : isWhiteboard ? (
          <WhiteboardMain search={search} navigate={navigate} />
        ) : isWorkstreams ? (
          <WorkstreamsMain id={workstreamId} navigate={navigate} />
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
        ) : isRecurring ? (
          <RecurringMain search={search} navigate={navigate} />
        ) : peopleRoute ? (
          <PeopleMain key={path} route={peopleRoute} navigate={navigate} />
        ) : placesRoute !== null ? (
          <PlacesMain route={placesRoute} navigate={navigate} />
        ) : extensionPage !== null ? (
          <ExtensionPageMain id={extensionPage} navigate={navigate} />
        ) : settingsHome ? (
          <SettingsHome navigate={navigate} />
        ) : settingsSection ? (
          <SettingsMain
            section={settingsSection}
            path={path}
            navigate={navigate}
            // On a phone a section's way back is the Settings list; the bar carries Today.
            back={
              narrow
                ? { label: 'Settings', onClick: () => navigate('/settings') }
                : { label: 'Today', onClick: () => navigate('/') }
            }
          />
        ) : isAudition ? (
          <AuditionMain back={{ label: 'Chat', onClick: newChat }} />
        ) : importId ? (
          <Fragment key={`${importId}:${importGeneration}`}>
            <ImportMain
              id={importId}
              back={{ label: 'Today', onClick: () => navigate('/') }}
              onStartAgain={queue.startAgain}
              droppedAgain={new URLSearchParams(search).has('dropped')}
            />
          </Fragment>
        ) : threadId ? (
          <Fragment key={threadId}>
            <ChatMain
              chat={chat}
              title={chatTitle}
              back={{ label: chatHome.label, onClick: goChatHome }}
              liveChats={
                liveRows.length > 0 ? (
                  <LiveChats rows={liveRows} hrefOf={chatListHref} navigate={navigate} />
                ) : undefined
              }
              onEnd={endThread}
              branches={[
                ...branchesOf(threadId).map((b) => ({ id: b.id, title: b.title, turn: b.parent?.turn ?? 0 })),
                // Filed beside this thread's file and not live: their marks open them as threads.
                ...chat.state.branches
                  .filter((b) => !others.some((t) => t.saved === b.chat))
                  .map((b) => ({ id: null, chat: b.chat, title: b.title, turn: b.turn })),
              ]}
              onBranched={openThread}
              // A saved branch named in the chat opens like its other links, in a new tab. The tab is
              // opened inside the click, the only time a browser allows one; a blocked tab turns this page.
              onOpenSaved={(saved) => {
                const tab = window.open('', '_blank')
                if (tab) tab.document.title = 'sky:chat - Opening chat'
                void openSaved(saved, tab)
              }}
            />
          </Fragment>
        ) : (
          <DayView
            onReview={openReview}
            onOpenDays={narrow ? () => setDaysOpen(true) : undefined}
            trackingDate={dayYmd}
            search={search}
            navigate={navigate}
            day={day}
            applyView={applyDayView}
            threads={others}
            imports={dayImports}
            importNotice={documentNotices.notice}
            onDismissImportNotice={documentNotices.dismiss}
            importDialogOpen={Boolean(queue.pending || queue.again)}
            chatNotice={chatNotices[0]}
            onDismissChatNotice={dismissChatNotice}
            onHelp={helpWithItem}
            onOpenSaved={(chat) => void openSaved(chat)}
            onOpenImport={openImport}
            onImportMeeting={queue.take}
            dragging={drop.dragging}
            onImportFiles={queue.take}
            onImportConversation={queue.takeConversation}
            kept={kept}
            onKept={setKept}
            onUndoKept={undoKept}
            onDismissKept={dismissKept}
            onStarted={() => {
              dayChanged()
              navigate('/')
            }}
          />
        )}
        {removal.toast && (
          <Fragment key={removal.toast.key}>
            <RemovedToast toast={removal.toast} onUndo={() => void removal.undo()} />
          </Fragment>
        )}
      </SearchWorkspace>
      {/* Below 900px the sidebar gives way to these: the bar, More, and the days a day's date opens. */}
      <BottomBar
        active={barTab}
        searching={isSearch}
        todayDot={Boolean(thisWeek?.due)}
        moreDot={waitingImports.length > 0}
        moreOpen={more}
        navigate={navigate}
        onChat={newChat}
        onMore={() => setMore((open) => !open)}
        onSearch={() => {
          setMore(false)
          openSearch()
        }}
      />
      <MorePanel
        open={more && narrow}
        active={moreActive}
        extensionPage={extensionPage}
        experiments={sidebarExperiments}
        brand={
          <>
            <span className="sky-brand">sky</span>
            <ClockAmbient snap={clock} active={isClock} onOpen={() => navigate('/clock')} />
          </>
        }
        notices={
          <>
            <RestartPending />
            <ImportsWaiting jobs={waitingImports} onOpen={openImport} />
          </>
        }
        navigate={navigate}
        onClose={() => setMore(false)}
      />
      <DaysSheet
        opened={daysOpen && narrow}
        onClose={() => setDaysOpen(false)}
        todayYmd={day?.today.ymd ?? null}
        todayActive={todayActive}
        {...dayNav}
      />
      {shownReview && (
        <DayReviewDialog
          key={shownReview}
          day={shownReview}
          prompted={!reviewDay}
          onEngage={() => openReview(shownReview, true)}
          onClose={() => {
            dismissPrompt(shownReview)
            if (reviewDay) closeReview()
          }}
          onChanged={dayChanged}
          navigate={navigate}
          onImportMeeting={queue.take}
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
