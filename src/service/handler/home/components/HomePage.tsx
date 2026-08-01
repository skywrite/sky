import { PAGE_CSS } from '../../markdown-preview/pageCss.ts'
import type { RecentDoc } from '../recents.ts'
import type { TodaySection } from '../today.ts'

export interface HomeCounts {
  documents: number
  people: number
  orgs: number
  projects: number
}

export interface HomePageData {
  today: TodaySection | null
  recents: RecentDoc[]
  counts: HomeCounts | null
  searchEnabled: boolean
}

const HOME_CSS = `
.home-shell {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.home-hero-title {
  margin: 0.35rem 0 0;
  font-size: 2rem;
  letter-spacing: -0.01em;
}

.home-eyebrow {
  margin: 0;
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--accent);
}

.home-counts {
  margin: 0.5rem 0 0;
  color: var(--text-muted);
  font-size: 0.95rem;
}

.home-hero-links {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}

.home-hero-links a {
  color: var(--accent-strong);
  font-size: 0.95rem;
  text-decoration: none;
  border-bottom: 1px solid rgba(20, 99, 86, 0.3);
  padding-bottom: 0.1rem;
}

.home-hero-links a:hover {
  border-bottom-color: var(--accent-strong);
}

.home-panel {
  border: 1px solid var(--panel-border);
  border-radius: 1.25rem;
  background: var(--panel-bg);
  backdrop-filter: blur(14px);
  box-shadow: 0 18px 36px rgba(16, 24, 40, 0.08);
  padding: 1.25rem 1.5rem;
}

.home-panel h2 {
  margin: 0 0 0.75rem;
  font-size: 1.05rem;
  letter-spacing: 0.02em;
  color: var(--text-muted);
  font-weight: 600;
  text-transform: uppercase;
  font-size: 0.8rem;
}

#home-search {
  width: 100%;
  font: inherit;
  font-size: 1.15rem;
  padding: 0.85rem 1.1rem;
  color: var(--text-main);
  background: rgba(255, 255, 255, 0.85);
  border: 1px solid var(--panel-border);
  border-radius: 0.85rem;
  outline: none;
}

#home-search:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(20, 99, 86, 0.15);
}

#home-search:disabled {
  opacity: 0.6;
}

.home-search-hint {
  margin: 0.6rem 0 0;
  font-size: 0.85rem;
  color: var(--text-muted);
}

#home-results {
  margin-top: 0.5rem;
}

.home-result {
  display: block;
  padding: 0.7rem 0.9rem;
  margin: 0.35rem 0;
  border: 1px solid transparent;
  border-radius: 0.85rem;
  text-decoration: none;
}

.home-result:hover,
.home-result.active {
  border-color: var(--panel-border);
  background: rgba(20, 99, 86, 0.06);
}

.home-result-head {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.home-result-title {
  font-weight: 600;
}

.home-result-kind {
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--accent-strong);
  background: rgba(20, 99, 86, 0.1);
  border-radius: 0.5rem;
  padding: 0.1rem 0.45rem;
}

.home-result-date {
  font-size: 0.8rem;
  color: var(--text-muted);
}

.home-result-path {
  display: block;
  margin-top: 0.15rem;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 0.75rem;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.home-result-snippet {
  margin: 0.35rem 0 0;
  font-size: 0.9rem;
  color: var(--text-muted);
}

.home-results-empty {
  margin: 0.6rem 0 0;
  font-size: 0.9rem;
  color: var(--text-muted);
}

mark {
  background: rgba(20, 99, 86, 0.16);
  color: inherit;
  border-radius: 0.2em;
  padding: 0 0.1em;
}

.home-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 1.5rem;
}

@media (max-width: 880px) {
  .home-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

.home-day-link {
  font-size: 1.05rem;
  color: var(--accent-strong);
  text-decoration: none;
  border-bottom: 1px solid rgba(20, 99, 86, 0.3);
  padding-bottom: 0.1rem;
}

.home-day-link:hover {
  border-bottom-color: var(--accent-strong);
}

.home-muted {
  color: var(--text-muted);
}

.home-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.home-list li {
  padding: 0.45rem 0;
  border-bottom: 1px solid rgba(17, 24, 39, 0.05);
}

.home-list li:last-child {
  border-bottom: none;
}

.home-list a {
  text-decoration: none;
}

.home-list a:hover {
  color: var(--accent-strong);
}

.home-subheading {
  margin: 1.1rem 0 0.4rem;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.home-streak-mark {
  display: inline-block;
  width: 1.2rem;
  color: var(--accent);
}

.home-streak-done {
  color: var(--text-muted);
  text-decoration: line-through;
  text-decoration-color: rgba(17, 24, 39, 0.35);
}

.home-recent-date {
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 0.75rem;
  color: var(--text-muted);
  margin-right: 0.6rem;
}

.home-recent-path {
  display: block;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 0.72rem;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
`

const HOME_SCRIPT = `
const input = document.getElementById('home-search')
const resultsEl = document.getElementById('home-results')

if (input && resultsEl && !input.disabled) {
  let items = []
  let active = -1
  let controller = null
  let debounceTimer = 0

  function docsHref(relativePath) {
    return '/docs/' + relativePath.split('/').map(encodeURIComponent).join('/')
  }

  function highlight(text, terms) {
    const fragment = document.createDocumentFragment()
    let position = 0
    const lower = text.toLowerCase()
    while (position < text.length) {
      let matchIndex = -1
      let matchLength = 0
      for (const term of terms) {
        const index = lower.indexOf(term, position)
        if (index !== -1 && (matchIndex === -1 || index < matchIndex)) {
          matchIndex = index
          matchLength = term.length
        }
      }
      if (matchIndex === -1) {
        fragment.appendChild(document.createTextNode(text.slice(position)))
        break
      }
      if (matchIndex > position) {
        fragment.appendChild(document.createTextNode(text.slice(position, matchIndex)))
      }
      const mark = document.createElement('mark')
      mark.textContent = text.slice(matchIndex, matchIndex + matchLength)
      fragment.appendChild(mark)
      position = matchIndex + matchLength
    }
    return fragment
  }

  function setActive(index) {
    active = index
    items.forEach((item, i) => item.classList.toggle('active', i === active))
    if (active >= 0) items[active].scrollIntoView({ block: 'nearest' })
  }

  function render(results, query) {
    resultsEl.textContent = ''
    items = []
    active = -1
    if (results.length === 0) {
      if (query.length > 0) {
        const empty = document.createElement('p')
        empty.className = 'home-results-empty'
        empty.textContent = 'No matches for "' + query + '".'
        resultsEl.appendChild(empty)
      }
      return
    }
    const terms = query.toLowerCase().split(/\\s+/).filter(Boolean)
    for (const result of results) {
      const link = document.createElement('a')
      link.className = 'home-result'
      link.href = docsHref(result.relativePath)

      const head = document.createElement('span')
      head.className = 'home-result-head'

      const title = document.createElement('span')
      title.className = 'home-result-title'
      title.appendChild(highlight(result.title, terms))
      head.appendChild(title)

      const kind = document.createElement('span')
      kind.className = 'home-result-kind'
      kind.textContent = result.kind
      head.appendChild(kind)

      if (result.date) {
        const date = document.createElement('span')
        date.className = 'home-result-date'
        date.textContent = result.date
        head.appendChild(date)
      }

      link.appendChild(head)

      const pathEl = document.createElement('span')
      pathEl.className = 'home-result-path'
      pathEl.textContent = result.relativePath
      link.appendChild(pathEl)

      if (result.snippet) {
        const snippet = document.createElement('p')
        snippet.className = 'home-result-snippet'
        snippet.appendChild(highlight(result.snippet, terms))
        link.appendChild(snippet)
      }

      resultsEl.appendChild(link)
      items.push(link)
    }
  }

  async function runSearch(query) {
    if (controller) controller.abort()
    if (query.length === 0) {
      render([], '')
      return
    }
    controller = new AbortController()
    try {
      const response = await fetch('/docs/_api/search?q=' + encodeURIComponent(query), {
        signal: controller.signal,
      })
      if (!response.ok) return
      const payload = await response.json()
      render(payload.results ?? [], query)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
    }
  }

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => runSearch(input.value.trim()), 160)
  })

  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (items.length > 0) setActive(Math.min(active + 1, items.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (items.length > 0) setActive(Math.max(active - 1, 0))
    } else if (event.key === 'Enter') {
      const target = items[active] ?? items[0]
      if (target) window.location.href = target.href
    } else if (event.key === 'Escape') {
      input.value = ''
      render([], '')
    }
  })

  document.addEventListener('keydown', (event) => {
    if (event.key !== '/' || event.target === input) return
    const tag = event.target instanceof HTMLElement ? event.target.tagName : ''
    if (tag === 'INPUT' || tag === 'TEXTAREA') return
    event.preventDefault()
    input.focus()
    input.select()
  })
}
`

export function HomePage({ data }: { data: HomePageData }) {
  const { today, recents, counts, searchEnabled } = data

  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Notebook</title>
        <style dangerouslySetInnerHTML={{ __html: PAGE_CSS }} />
        <style dangerouslySetInnerHTML={{ __html: HOME_CSS }} />
      </head>
      <body>
        <div className="page-shell home-shell">
          <header className="hero">
            <div>
              <p className="home-eyebrow">Notebook</p>
              <h1 className="home-hero-title">{today?.dateLabel ?? 'Home'}</h1>
              {counts ? (
                <p className="home-counts">
                  {counts.documents.toLocaleString('en-US')} documents · {counts.people.toLocaleString('en-US')} people
                  · {counts.orgs.toLocaleString('en-US')} orgs · {counts.projects.toLocaleString('en-US')} projects
                </p>
              ) : null}
            </div>
            <div className="home-hero-links">
              <a href="/docs">Browse docs</a>
              <a href="/graphql">GraphQL</a>
            </div>
          </header>

          <section className="home-panel" aria-label="Search">
            <input
              id="home-search"
              type="search"
              placeholder="Search people, projects, meetings, anything…"
              autoComplete="off"
              spellCheck={false}
              autoFocus={searchEnabled}
              disabled={!searchEnabled}
            />
            {searchEnabled ? (
              <p className="home-search-hint">Press / to focus · arrows to move · Enter to open</p>
            ) : (
              <p className="home-search-hint">Search index is still warming up — refresh in a moment.</p>
            )}
            <div id="home-results" />
          </section>

          <div className="home-grid">
            <section className="home-panel home-today" aria-label="Today">
              <h2>Today</h2>
              {today ? (
                <>
                  {today.dayRelativePath ? (
                    <a className="home-day-link" href={docsHref(today.dayRelativePath)}>
                      Open today&rsquo;s day
                    </a>
                  ) : (
                    <p className="home-muted">No day file yet.</p>
                  )}

                  {today.mostImportant.length > 0 ? (
                    <>
                      <p className="home-subheading">Most important</p>
                      <ul className="home-list">
                        {today.mostImportant.map((item) => (
                          <li key={item.relativePath}>
                            <a href={docsHref(item.relativePath)}>{item.label}</a>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}

                  {today.streaks.length > 0 ? (
                    <>
                      <p className="home-subheading">Streaks</p>
                      <ul className="home-list">
                        {today.streaks.map((streak) => (
                          <li key={streak.title}>
                            <span className="home-streak-mark">{streak.doneToday ? '●' : '○'}</span>
                            <span className={streak.doneToday ? 'home-streak-done' : undefined}>{streak.title}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                </>
              ) : (
                <p className="home-muted">Day tracking is unavailable.</p>
              )}
            </section>

            <section className="home-panel home-recents" aria-label="Recent">
              <h2>Recent</h2>
              {recents.length > 0 ? (
                <ul className="home-list">
                  {recents.map((recent) => (
                    <li key={recent.relativePath}>
                      <a href={docsHref(recent.relativePath)}>
                        <span className="home-recent-date">{recent.date}</span>
                        {recent.title}
                        <span className="home-recent-path">{recent.relativePath}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="home-muted">Nothing indexed yet.</p>
              )}
            </section>
          </div>
        </div>
        <script type="module" dangerouslySetInnerHTML={{ __html: HOME_SCRIPT }} />
      </body>
    </html>
  )
}

function docsHref(relativePath: string): string {
  return '/docs/' + relativePath.split('/').map(encodeURIComponent).join('/')
}
