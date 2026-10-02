import { useEffect } from 'react'
import type { DaySummary, SummaryPassage } from '../../day/summary.ts'
import { fileHref } from './explorer.tsx'
import { RenderedHtml } from './renderedHtml.tsx'

/** Refresh one small file without rebuilding the day's plan or replacing unchanged prose. */
export function useSummaryRefresh(ymd: string | undefined, onRead: (summary: DaySummary | null) => void) {
  useEffect(() => {
    if (!ymd) return
    const controller = new AbortController()
    let reading = false
    const read = async () => {
      if (document.hidden || reading) return
      reading = true
      try {
        const response = await fetch(`/day/${ymd}/summary`, { signal: controller.signal })
        if (response.ok && !controller.signal.aborted) {
          const body = (await response.json()) as { summary: DaySummary | null }
          if (!controller.signal.aborted) onRead(body.summary)
        }
      } catch {
        // A temporary connection failure leaves the saved view readable.
      } finally {
        reading = false
      }
    }
    const timer = window.setInterval(() => void read(), 5000)
    window.addEventListener('focus', read)
    document.addEventListener('visibilitychange', read)
    return () => {
      controller.abort()
      window.clearInterval(timer)
      window.removeEventListener('focus', read)
      document.removeEventListener('visibilitychange', read)
    }
  }, [ymd, onRead])
}

function Passage({ passage, className }: { passage: SummaryPassage; className: string }) {
  return (
    <>
      <RenderedHtml html={passage.html} className={className} />
      {passage.sources.length > 0 && (
        <div className="sky-summary-sources" aria-label="Sources">
          {passage.sources.map((source) => (
            <a key={source.href} href={source.href}>
              {source.label}
              <span aria-hidden="true">↗</span>
            </a>
          ))}
        </div>
      )}
    </>
  )
}

export function DaySummaryView({ summary, weekday }: { summary: DaySummary; weekday: string }) {
  const document = summary.documentHtml !== null
  return (
    <article className="sky-day-summary" aria-label={`${weekday} summary`}>
      <header className="sky-summary-opening">
        <div className="sky-summary-kicker">
          <span className="sky-summary-kicker-line" aria-hidden="true" />
          <span>The day, remembered</span>
          {summary.location && <span className="sky-summary-location">{summary.location}</span>}
        </div>
        <h1>{summary.headline || (document ? 'Daily summary' : `${weekday}, remembered`)}</h1>
        {!document && <Passage passage={summary.opening} className="sky-summary-story" />}
      </header>

      {document &&
        (summary.documentHtml ? (
          <RenderedHtml html={summary.documentHtml} className="sky-summary-document" />
        ) : (
          <p className="sky-summary-empty">
            This summary is empty. Open the file to add to it, or visit the day record.
          </p>
        ))}

      {summary.moments.length > 0 && (
        <section className="sky-summary-moments" aria-labelledby="sky-summary-moments-title">
          <h2 id="sky-summary-moments-title">Meaningful moments</h2>
          <div className="sky-summary-moment-grid" data-count={summary.moments.length}>
            {summary.moments.map((moment, index) => (
              <section className="sky-summary-moment" key={index}>
                <div className="sky-summary-moment-top">
                  <span className="sky-summary-moment-mark" aria-hidden="true">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  {moment.when && <span className="sky-summary-moment-time">{moment.when}</span>}
                  <span className="sky-summary-moment-line" aria-hidden="true" />
                </div>
                <h3>{moment.title}</h3>
                <Passage passage={moment} className="sky-summary-moment-prose" />
              </section>
            ))}
          </div>
        </section>
      )}

      <footer className="sky-summary-file">
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Zm0 0v15" />
        </svg>
        <div className="sky-summary-file-copy">
          <strong>The rest of {weekday} is here.</strong>
          <span>Decisions, commitments, insights, and the complete record.</span>
        </div>
        <a className="sky-summary-read-full" href={fileHref(summary.path)}>
          <span>
            Read full summary <span aria-hidden="true">↗</span>
          </span>
          <small>summary.md</small>
        </a>
      </footer>
    </article>
  )
}
