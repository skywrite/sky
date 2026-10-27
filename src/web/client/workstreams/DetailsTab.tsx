import { Button } from '@mantine/core'
import { fileHref } from '../explorer/explorer.tsx'
import { Prose } from './Prose.tsx'
import { RelatedWork } from './RelatedWork.tsx'
import { moment, useWorkstreamDetail } from './WorkstreamDetailContext.ts'
import { WorkstreamReports } from './WorkstreamReports.tsx'

export function DetailsTab() {
  const { item, runs, busy, act, navigate, onRelate, onSubstream, openEditor, openArtifact } = useWorkstreamDetail()
  return (
    <>
      <div className="sky-workstream-brief-view-intro">
        <h3>The context behind the work</h3>
        <p>People, source material, reporting, and what has happened.</p>
      </div>
      <section className="sky-workstream-section">
        <div className="sky-workstream-section-head">
          <h3>The wider picture</h3>
          <Button size="xs" onClick={() => onRelate(item.id)}>
            Relate to…
          </Button>
        </div>
        <RelatedWork />
        <Button size="xs" onClick={onSubstream}>
          ＋ Sub-workstream
        </Button>
      </section>
      {item.artifacts.length > 0 && (
        <section className="sky-workstream-section">
          <h3>Prepared work</h3>
          {[...item.artifacts].reverse().map((value) => (
            <button
              className="sky-workstream-artifact"
              type="button"
              key={value.id}
              disabled={busy}
              onClick={() => openArtifact(value)}
            >
              <span>▤</span>
              <span>
                <strong>{value.title}</strong>
                <small>
                  {value.kind} · {moment(value.created)}
                </small>
              </span>
              <span>↗</span>
            </button>
          ))}
        </section>
      )}
      {item.reporting.length > 0 && (
        <WorkstreamReports item={item} busy={busy} act={act} onEdit={() => openEditor('details')} navigate={navigate} />
      )}
      <section className="sky-workstream-section">
        <div className="sky-workstream-section-head">
          <h3>People, timing & details</h3>
          <Button size="xs" onClick={() => openEditor('details')}>
            Edit
          </Button>
        </div>
        {item.stakeholders.length ? (
          <div className="sky-workstream-people">
            {item.stakeholders.map((person) => (
              <span key={person.id}>
                <strong>{person.name}</strong>
                {person.role && <small>{person.role}</small>}
              </span>
            ))}
          </div>
        ) : (
          <p className="sky-workstream-hint">
            Add stakeholders, metrics, sources, and reporting when they become useful.
          </p>
        )}
        {item.metrics.map((metric) => (
          <p className="sky-workstream-metric" key={metric.id}>
            <strong>{metric.name}</strong>
            <span>
              {metric.current || '—'}
              {metric.unit ? ` ${metric.unit}` : ''}
              {metric.target ? ` / ${metric.target}` : ''}
            </span>
          </p>
        ))}
        {item.sources.map((source) => (
          <a className="sky-workstream-source" key={source.id} href={fileHref(source.path)}>
            {source.label || source.path}
            {source.sensitive ? ' · Sensitive' : ''} ↗
          </a>
        ))}
      </section>

      <section className="sky-workstream-section">
        <div className="sky-workstream-section-head">
          <h3>Sky’s responsibility</h3>
          <Button size="xs" onClick={() => openEditor('sky')}>
            {item.sky.mode === 'off' ? 'Give responsibility' : 'Responsibility'}
          </Button>
        </div>
        <p className="sky-workstream-hint">
          {item.sky.mode === 'off'
            ? 'Ongoing help is off. You can still ask Sky for a specific next step.'
            : `${item.sky.mode === 'drive' ? 'Carrying the work' : 'Assisting'} · Reviews every ${item.sky.reviewEveryHours} hours`}
        </p>
        {item.sky.instruction && <Prose text={item.sky.instruction} />}
        {item.sky.mode !== 'off' && item.sky.nextReviewAt && (
          <p className="sky-workstream-hint">Next review {moment(item.sky.nextReviewAt)}</p>
        )}
      </section>
      {item.unknowns.length > 0 && (
        <details className="sky-workstream-disclosure">
          <summary>Still to understand · {item.unknowns.length}</summary>
          <ul>
            {item.unknowns.map((unknown, index) => (
              <li key={index}>{unknown}</li>
            ))}
          </ul>
        </details>
      )}
      {item.notes && (
        <details className="sky-workstream-disclosure">
          <summary>Working notes</summary>
          <Prose text={item.notes} />
        </details>
      )}
      <details className="sky-workstream-disclosure">
        <summary>Activity & Sky reviews</summary>
        {[...runs].slice(0, 12).map((run) => (
          <div className="sky-workstream-history" key={run.id}>
            <small>
              {moment(run.started)} · Sky · {run.status}
            </small>
            <p>
              {run.error || run.summary || (run.status === 'running' ? 'Review in progress.' : 'No summary recorded.')}
            </p>
          </div>
        ))}
        {[...item.history]
          .reverse()
          .slice(0, 30)
          .map((entry) => (
            <div className="sky-workstream-history" key={entry.id}>
              <small>
                {moment(entry.at)} · {entry.actor === 'sky' ? 'Sky' : 'You'}
              </small>
              <p>{entry.summary}</p>
            </div>
          ))}
      </details>
    </>
  )
}
