import { Button } from '@mantine/core'
import { useEffect, useRef, useState } from 'react'
import {
  activeDocuments,
  findingBasis,
  openFindings,
  type Decision,
  type Finding,
  type LegalReview,
} from '#lib/legalReview/types.ts'
import './legalReview.css'

const DECISIONS: Record<Decision['action'], string> = {
  'ask-team': 'Ask the team',
  'accept-risk': 'Accept this risk',
  resolved: 'Mark resolved',
  reopen: 'Reopen',
}
const DECIDED: Record<Decision['action'], string> = {
  'ask-team': 'You chose to ask the team',
  'accept-risk': 'You accepted this risk',
  resolved: 'You marked this resolved',
  reopen: 'You reopened this issue',
}

export function LegalReviewSummary({ chatId, busy }: { chatId: string; busy: boolean }) {
  const currentChat = useRef(chatId)
  currentChat.current = chatId
  const [review, setReview] = useState<LegalReview | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState<string | null>(null)
  useEffect(() => {
    let stopped = false
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    setReview(null)
    setError('')
    setSaving(null)
    const read = async () => {
      try {
        const response = await fetch(`/chat/${chatId}/legal-review`, { signal: controller.signal })
        if (response.status === 404) {
          const body = await response.json().catch(() => ({}))
          if (body.message === 'The linked review file is missing.') throw new Error(body.message)
          return
        }
        const body = await response.json()
        if (!response.ok) throw new Error(body.message ?? 'Could not load the agreement review.')
        if (!stopped) {
          setReview((prior) =>
            (prior && body.review && prior.id === body.review.id && prior.revision > body.review.revision) ||
            JSON.stringify(prior) === JSON.stringify(body.review)
              ? prior
              : body.review,
          )
          setError('')
        }
      } catch (problem) {
        if (!stopped) setError((problem as Error).message)
      } finally {
        if (!stopped) timer = setTimeout(() => void read(), 3000)
      }
    }
    void read()
    return () => {
      stopped = true
      controller.abort()
      clearTimeout(timer)
    }
  }, [chatId])

  const decide = async (finding: Finding, action: Decision['action']) => {
    if (!review || saving) return
    setSaving(finding.id)
    setError('')
    try {
      const response = await fetch(`/chat/${chatId}/legal-review/decisions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ findingId: finding.id, action, revision: review.revision }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.message ?? 'Could not save your decision.')
      if (currentChat.current === chatId)
        setReview((prior) =>
          prior && (prior.id !== body.review.id || prior.revision > body.review.revision) ? prior : body.review,
        )
    } catch (problem) {
      if (currentChat.current === chatId) setError((problem as Error).message)
    } finally {
      if (currentChat.current === chatId) setSaving(null)
    }
  }

  if (!review)
    return error ? (
      <p className="sky-legal-error" role="alert">
        {error}
      </p>
    ) : null
  const documents = activeDocuments(review)
  const issues = openFindings(review)
  const source = (id: string) => `/chat/${chatId}/legal-review/files/${id}`
  return (
    <details className="sky-legal-review">
      <summary>
        <span>Agreement review</span>
        <span className="sky-legal-counts">
          {documents.length}
          {review.expectedDocuments ? ` of ${review.expectedDocuments}` : ''} agreements ·{' '}
          {documents.filter((doc) => doc.status === 'reviewed').length} reviewed · {issues.length}{' '}
          {issues.length === 1 ? 'issue' : 'issues'} to discuss
        </span>
      </summary>
      <div className="sky-legal-body">
        <h3>{review.title}</h3>
        {review.perspective && (
          <p>
            Reviewing for <strong>{review.perspective.party}</strong>. {review.perspective.basis}
          </p>
        )}
        {review.perspective?.uncertainties.map((item) => (
          <p key={item} className="sky-legal-notice">
            {item}
          </p>
        ))}
        {review.comparison.status === 'needed' && (
          <p className="sky-legal-notice">
            {busy
              ? 'Review in progress. Earlier findings may change.'
              : 'The comparison needs another review. Ask Sky to review the current set.'}
          </p>
        )}
        {review.expectedDocuments && documents.length < review.expectedDocuments && (
          <p>
            {review.expectedDocuments - documents.length} more agreements expected. Drop the next file into this chat.
          </p>
        )}
        {review.lastError && (
          <p className="sky-legal-error" role="alert">
            {review.lastError}
          </p>
        )}
        <h4>Document map</h4>
        <ul className="sky-legal-documents">
          {review.documents.map((doc) => (
            <li key={doc.id}>
              <a href={source(doc.id)}>{doc.details?.title || doc.name}</a>
              <span className="sky-legal-meta">
                {doc.supersededBy
                  ? 'Superseded version'
                  : doc.status === 'pending'
                    ? 'Awaiting review'
                    : doc.status === 'partial'
                      ? 'Partially reviewed'
                      : 'Reviewed'}
                {doc.details ? ` · ${doc.details.version}` : ''}
              </span>
              {doc.details?.purpose && <p>{doc.details.purpose}</p>}
              {doc.details?.relationships.map((relation, i) => (
                <p key={i}>
                  {relation.kind.replaceAll('-', ' ')}{' '}
                  <a href={source(relation.documentId)}>
                    {review.documents.find((item) => item.id === relation.documentId)?.details?.title ?? 'agreement'}
                  </a>
                  : {relation.explanation}
                </p>
              ))}
              {doc.details?.limitations.map((limitation) => (
                <p className="sky-legal-notice" key={limitation}>
                  {limitation}
                </p>
              ))}
            </li>
          ))}
        </ul>
        <h4>Across the agreements</h4>
        <p>{review.comparison.summary}</p>
        {review.missingDocuments.length > 0 && (
          <p className="sky-legal-notice">Missing documents: {review.missingDocuments.join('; ')}</p>
        )}
        <h4>Findings and your decisions</h4>
        {review.findings.length === 0 && (
          <p>
            {review.comparison.status === 'current'
              ? 'No material issues were identified in the reviewed text.'
              : 'Findings will appear here after review.'}
          </p>
        )}
        {review.findings.map((finding) => {
          const decision = review.decisions.findLast((item) => item.findingId === finding.id)
          const changed = decision && decision.basis !== findingBasis(finding)
          return (
            <details key={finding.id} className="sky-legal-finding">
              <summary>
                <strong>{finding.title}</strong>
                <span className="sky-legal-meta">
                  {finding.severity} ·{' '}
                  {finding.needsRecheck
                    ? 'needs recheck'
                    : decision && !changed
                      ? DECIDED[decision.action]
                      : `AI assessment: ${finding.assessment}`}
                </span>
              </summary>
              <p>{finding.explanation}</p>
              <p>
                <strong>Suggested next step:</strong> {finding.recommendation}
              </p>
              {finding.evidence.map((evidence, i) => (
                <div key={i} className="sky-legal-evidence">
                  <a href={source(evidence.documentId)}>
                    {review.documents.find((doc) => doc.id === evidence.documentId)?.name}
                  </a>{' '}
                  · {evidence.location}
                  <blockquote>{evidence.quote}</blockquote>
                  {evidence.verification !== 'text-matched' && (
                    <span className="sky-legal-meta">
                      {evidence.verification === 'pdf-citation'
                        ? 'Citation read from the original PDF'
                        : 'Quotation needs verification against the original'}
                    </span>
                  )}
                </div>
              ))}
              {decision && (
                <p>
                  {DECIDED[decision.action]}.
                  {changed ? ' The finding changed since that decision; review it again.' : ''}
                </p>
              )}
              <div className="sky-legal-actions" aria-label={`Your decision on ${finding.title}`}>
                {(Object.keys(DECISIONS) as Decision['action'][])
                  .filter((action) => action !== 'reopen' || decision)
                  .map((action) => (
                    <Button
                      key={action}
                      variant="subtle"
                      size="compact-md"
                      disabled={busy || saving !== null}
                      onClick={() => void decide(finding, action)}
                    >
                      {DECISIONS[action]}
                    </Button>
                  ))}
              </div>
            </details>
          )
        })}
        {error && (
          <p className="sky-legal-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </details>
  )
}
