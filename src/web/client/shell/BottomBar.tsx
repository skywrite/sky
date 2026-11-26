import type { MouseEvent } from 'react'
import { SidebarIcon } from './sidebarIcon.tsx'
import './BottomBar.css'

export type BarTab = 'today' | 'future' | 'chat' | 'more'

/** An ordinary click turns the page in place; a modified one keeps the link's own behavior. */
function inPlace(event: MouseEvent<HTMLAnchorElement>, go: () => void) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
    return
  event.preventDefault()
  go()
}

/**
 * The narrow layout's navigation, in reach of a thumb: Today, Future, Chat and More,
 * with search on its own beside them. The stylesheet shows it only below 900px.
 */
export function BottomBar({
  active,
  searching,
  todayDot,
  moreDot,
  moreOpen,
  navigate,
  onChat,
  onMore,
  onSearch,
}: {
  active: BarTab | null
  /** The results page is open */
  searching: boolean
  /** A day is waiting to start */
  todayDot: boolean
  /** Something behind More needs the person, such as an import to review */
  moreDot: boolean
  moreOpen: boolean
  navigate: (to: string) => void
  onChat: () => void
  onMore: () => void
  onSearch: () => void
}) {
  const current = (tab: BarTab) => (active === tab && !moreOpen) || (tab === 'more' && moreOpen)
  return (
    <nav className="sky-bar" aria-label="Main">
      <div className="sky-bar-tabs">
        <a
          href="/"
          className="sky-bar-tab"
          data-active={current('today')}
          aria-current={active === 'today' ? 'page' : undefined}
          onClick={(event) => inPlace(event, () => navigate('/'))}
        >
          <SidebarIcon name="today" />
          <span>Today</span>
          {todayDot && <span className="sky-bar-dot" aria-hidden="true" />}
        </a>
        <a
          href="/future"
          className="sky-bar-tab"
          data-active={current('future')}
          aria-current={active === 'future' ? 'page' : undefined}
          onClick={(event) => inPlace(event, () => navigate('/future'))}
        >
          <SidebarIcon name="future" />
          <span>Future</span>
        </a>
        <button
          type="button"
          className="sky-bar-tab"
          data-active={current('chat')}
          aria-current={active === 'chat' ? 'page' : undefined}
          onClick={onChat}
        >
          <SidebarIcon name="chat" />
          <span>Chat</span>
        </button>
        <button
          type="button"
          className="sky-bar-tab"
          data-active={current('more')}
          aria-current={active === 'more' && !moreOpen ? 'page' : undefined}
          aria-expanded={moreOpen}
          aria-controls="sky-more-panel"
          onClick={onMore}
        >
          <SidebarIcon name="more" />
          <span>More</span>
          {moreDot && <span className="sky-bar-dot" aria-hidden="true" />}
        </button>
      </div>
      <button type="button" className="sky-bar-search" data-active={searching} aria-label="Search" onClick={onSearch}>
        <SidebarIcon name="search" />
      </button>
    </nav>
  )
}
