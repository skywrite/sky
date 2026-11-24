import type { DecisionRecord } from '#lib/decisionWizard/record.ts'
import { niceDate } from '../dates.ts'

/** The record as the decision's file will read: every line the person's own, or one they chose. */
export function RecordView({ record, today }: { record: DecisionRecord; today: string }) {
  const when =
    record.call === null
      ? null
      : `Decided ${niceDate(record.when ?? today, today)}${record.when ? `. Written down ${niceDate(today, today)}` : ''}.`
  return (
    <div className="sky-wizard-doc">
      <h3>The decision</h3>
      <p>{record.title}</p>
      <small>
        {when ?? (record.target ? `Open. Decide by ${niceDate(record.target, today)}.` : 'Open.')}{' '}
        {record.inForce && <span className="sky-wizard-state">In force</span>}
      </small>
      {record.call !== null && (
        <>
          <h3>The call</h3>
          <p>{record.call}</p>
          {record.callNote && <small>{record.callNote}</small>}
        </>
      )}
      {record.wants.length > 0 && (
        <>
          <h3>{record.when ? 'What I wanted' : record.wantsOrdered ? 'What I want, in order' : 'What I want'}</h3>
          {record.wantsOrdered ? (
            <ol>
              {record.wants.map((want) => (
                <li key={want}>{want}</li>
              ))}
            </ol>
          ) : (
            <ul>
              {record.wants.map((want) => (
                <li key={want}>{want}</li>
              ))}
            </ul>
          )}
        </>
      )}
      {record.sections.map((section) => (
        <section key={section.heading}>
          <h3>{section.heading}</h3>
          {section.list ? (
            <ul>
              {section.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : (
            section.lines.map((line) => <p key={line}>{line}</p>)
          )}
        </section>
      ))}
    </div>
  )
}
