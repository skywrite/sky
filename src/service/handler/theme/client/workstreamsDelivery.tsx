import { ActionIcon, Button, Modal, NumberInput, Select, TextInput } from '@mantine/core'
import { Fragment, useCallback, useEffect, useState } from 'react'
import type {
  ReportDeliveryAttachment,
  ReportDeliveryGrant,
  ReportDeliveryRecord,
  ReportDeliverySettings,
  ReportDeliveryTarget,
} from '#lib/workstreams/delivery.ts'
import type { Reporting, WorkstreamRecord } from '#lib/workstreams/types.ts'
import { outboxHref } from './outboxRoutes.ts'
import { RenderedHtml } from './renderedHtml.tsx'
import { workstreamRequest } from './workstreams.tsx'
import {
  canSendReport,
  describeReportTarget,
  reportDeliveryMode,
  reportDeliveryStatus,
  reportTargetLink,
  slackReportTarget,
} from './workstreamsDeliveryModel.ts'
import { renderStatic } from './wysiwyg/render.ts'

type DeliveryReport = {
  grants: (ReportDeliveryGrant & { scopeCurrent?: boolean })[]
  deliveries: ReportDeliveryRecord[]
}

export function WorkstreamReports({
  item,
  busy,
  act,
  onEdit,
  navigate,
}: {
  item: WorkstreamRecord
  busy: boolean
  act: (action: () => Promise<void>) => Promise<void>
  onEdit: () => void
  navigate: (path: string) => void
}) {
  const [report, setReport] = useState<DeliveryReport | null>(null)
  const [error, setError] = useState('')
  const [configuration, setConfiguration] = useState<{
    policy: Reporting
    grant: ReportDeliveryGrant
    revision: string
  } | null>(null)
  const [review, setReview] = useState<ReportDeliveryRecord | null>(null)
  const refresh = useCallback(async () => {
    setReport(await workstreamRequest<DeliveryReport>(`/${item.id}/reporting/delivery`))
    setError('')
  }, [item.id])
  useEffect(() => {
    let alive = true
    const read = () => {
      if (alive)
        void refresh().catch((problem: Error) => {
          if (alive) setError(problem.message)
        })
    }
    read()
    const timer = setInterval(read, 10_000)
    window.addEventListener('focus', read)
    return () => {
      alive = false
      clearInterval(timer)
      window.removeEventListener('focus', read)
    }
  }, [refresh, item.revision])
  const configure = (policy: Reporting) => {
    const grant = report?.grants.find((value) => value.reportingId === policy.id)
    if (grant) setConfiguration({ policy, grant, revision: item.revision })
  }
  return (
    <section className="sky-workstream-section">
      <div className="sky-workstream-section-head">
        <h3>Keeping people informed</h3>
        <Button size="xs" onClick={onEdit}>
          Edit reporting
        </Button>
      </div>
      {error && (
        <p className="sky-workstreams-error" role="alert">
          {error}
        </p>
      )}
      {item.reporting.map((policy) => {
        const grant = report?.grants.find((value) => value.reportingId === policy.id)
        const deliveries = report?.deliveries.filter((value) => value.reportingId === policy.id) ?? []
        const latest = deliveries[0]
        return (
          <div className="sky-workstream-report" key={policy.id}>
            <div className="sky-workstream-section-head">
              <strong>{policy.audience}</strong>
              {['email', 'slack'].includes(policy.medium) && (
                <Button size="xs" disabled={!grant || busy} onClick={() => configure(policy)}>
                  {policy.medium === 'email'
                    ? 'Review settings'
                    : grant?.mode === 'send'
                      ? 'Delivery settings'
                      : 'Set up delivery'}
                </Button>
              )}
            </div>
            <span>
              Every {policy.cadenceDays} days · {policy.medium}
              {policy.destination ? ` · ${policy.destination}` : ''}
            </span>
            <div className="sky-workstream-report-actions">
              <Button
                size="xs"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await workstreamRequest(`/${item.id}/reporting/${policy.id}/prepare`, 'POST', {
                      revision: item.revision,
                    })
                    await refresh()
                  })
                }
              >
                Prepare fresh report
              </Button>
            </div>
            {policy.instructions && <p>{policy.instructions}</p>}
            {policy.artifacts.length > 0 && <small>{policy.artifacts.join(' + ')}</small>}
            {grant && (
              <div className="sky-workstream-report-authority">
                <span>
                  {reportDeliveryMode(policy.medium, grant.mode) === 'send' && grant.target?.medium !== 'email'
                    ? grant.scopeCurrent === false
                      ? 'Delivery scope changed · Renew authorization'
                      : 'Recurring delivery authorized'
                    : 'Prepared for your review'}
                </span>
                {grant.target && <small>{describeReportTarget(grant.target)}</small>}
              </div>
            )}
            {latest ? (
              <div className="sky-workstream-report-status" data-status={latest.status}>
                <strong>{reportDeliveryStatus(latest)}</strong>
                <small>{latest.updated.replace('T', ' ').slice(0, 16)}</small>
                {latest.error && <p>{latest.error}</p>}
                {latest.blockers.length > 0 && (
                  <>
                    <ul>
                      {latest.blockers.map((blocker, index) => (
                        <li key={index}>{blocker}</li>
                      ))}
                    </ul>
                    <p className="sky-workstream-hint">
                      Update the supporting context, add artifact links in Edit reporting, then prepare a fresh report.
                    </p>
                  </>
                )}
                {latest.receipt && (
                  <a href={latest.receipt.url} target="_blank" rel="noreferrer">
                    View delivered report ↗
                  </a>
                )}
                <div className="sky-workstream-report-actions">
                  <Button size="xs" onClick={() => setReview(latest)}>
                    {canSendReport(latest, policy.medium)
                      ? 'Review & send'
                      : latest.status === 'review' || latest.status === 'failed'
                        ? 'Review report'
                        : 'View report'}
                  </Button>
                  {latest.outboxId && (
                    <Button size="xs" onClick={() => navigate(outboxHref(latest.outboxId!))}>
                      Outbox ↗
                    </Button>
                  )}
                  {latest.status === 'unknown' && (
                    <Button
                      size="xs"
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          await workstreamRequest(`/${item.id}/deliveries/reconcile`, 'POST', {})
                          await refresh()
                        })
                      }
                    >
                      Check delivery
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <small>
                {policy.lastPreparedAt
                  ? `Last prepared ${policy.lastPreparedAt.replace('T', ' ').slice(0, 16)}`
                  : 'No report prepared yet'}
              </small>
            )}
            {deliveries.length > 1 && (
              <details className="sky-workstream-disclosure">
                <summary>Previous updates · {deliveries.length - 1}</summary>
                {deliveries.slice(1, 10).map((delivery) => (
                  <button
                    type="button"
                    className="sky-workstream-report-history"
                    key={delivery.id}
                    onClick={() => setReview(delivery)}
                  >
                    <span>{delivery.title}</span>
                    <small>
                      {reportDeliveryStatus(delivery)} · {delivery.created.slice(0, 10)}
                    </small>
                  </button>
                ))}
              </details>
            )}
          </div>
        )
      })}
      {configuration && (
        <Fragment key={configuration.policy.id}>
          <ReportDeliveryEditor
            policy={configuration.policy}
            grant={configuration.grant}
            busy={busy}
            onClose={() => setConfiguration(null)}
            onSave={(settings) =>
              void act(async () => {
                await workstreamRequest(`/${item.id}/reporting/${configuration.policy.id}/delivery`, 'POST', {
                  revision: configuration.revision,
                  grantRevision: configuration.grant.revision,
                  settings,
                })
                setConfiguration(null)
                await refresh()
              })
            }
          />
        </Fragment>
      )}
      {review && (
        <Fragment key={review.id}>
          <ReportReview
            item={review}
            policy={item.reporting.find((policy) => policy.id === review.reportingId)}
            busy={busy}
            onClose={() => setReview(null)}
            navigate={navigate}
            onSend={(target, attachments) =>
              void act(async () => {
                if (target?.medium !== 'slack') return
                await workstreamRequest(`/${item.id}/deliveries/${review.id}/send`, 'POST', {
                  revision: review.revision,
                  target,
                  attachments,
                })
                setReview(null)
                await refresh()
              })
            }
          />
        </Fragment>
      )}
    </section>
  )
}

type TargetFields = { account: string; to: string; slack: string }
function targetFields(target?: ReportDeliveryTarget): TargetFields {
  return {
    account: target?.medium === 'email' ? target.account : '',
    to: target?.medium === 'email' ? target.to.join(', ') : '',
    slack: reportTargetLink(target),
  }
}
function readTarget(medium: string, fields: TargetFields): ReportDeliveryTarget | undefined {
  if (medium === 'slack') return fields.slack.trim() ? slackReportTarget(fields.slack) : undefined
  if (medium === 'email') {
    if (!fields.account.trim() && !fields.to.trim()) return undefined
    const to = [
      ...new Set(
        fields.to
          .split(/[,;\n]/)
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ]
    if (
      !fields.account.trim() ||
      !to.length ||
      [fields.account, ...to].some((value) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()))
    )
      throw new Error('Choose the email account and complete recipient email addresses.')
    return { medium: 'email', account: fields.account.trim(), to }
  }
  return undefined
}

function DeliveryTargetFields({
  medium,
  value,
  onChange,
}: {
  medium: string
  value: TargetFields
  onChange: (value: TargetFields) => void
}) {
  return medium === 'email' ? (
    <>
      <TextInput
        label="From account"
        type="email"
        description="The connected account for this email report."
        value={value.account}
        onChange={(event) => onChange({ ...value, account: event.currentTarget.value })}
      />
      <TextInput
        label="To"
        description="Exact email addresses, separated with commas."
        value={value.to}
        onChange={(event) => onChange({ ...value, to: event.currentTarget.value })}
      />
    </>
  ) : medium === 'slack' ? (
    <TextInput
      label="Slack channel or conversation link"
      description="Paste the full link to the destination. A message link keeps updates in that thread."
      placeholder="https://workspace.slack.com/archives/…"
      value={value.slack}
      onChange={(event) => onChange({ ...value, slack: event.currentTarget.value })}
    />
  ) : (
    <p className="sky-workstream-hint">Choose email or Slack in the reporting arrangement to enable delivery.</p>
  )
}

function ReportDeliveryEditor({
  policy,
  grant,
  busy,
  onClose,
  onSave,
}: {
  policy: Reporting
  grant: ReportDeliveryGrant
  busy: boolean
  onClose: () => void
  onSave: (settings: ReportDeliverySettings) => void
}) {
  const [selectedMode, setMode] = useState(() => reportDeliveryMode(policy.medium, grant.mode))
  const mode = reportDeliveryMode(policy.medium, selectedMode)
  const email = policy.medium === 'email'
  const [fields, setFields] = useState(() => targetFields(grant.target))
  const [maxPerDay, setMaxPerDay] = useState(grant.maxPerDay)
  const [error, setError] = useState('')
  const save = () => {
    try {
      const target = readTarget(policy.medium, fields)
      if (mode === 'send' && !target) throw new Error('Choose the exact destination before authorizing delivery.')
      onSave({ mode, target, maxPerDay })
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Check the delivery destination.')
    }
  }
  return (
    <Modal opened onClose={onClose} title={`Reporting to ${policy.audience}`} size="lg">
      <div className="sky-workstream-edit">
        <p>
          Every {policy.cadenceDays} days · {policy.medium} ·{' '}
          {policy.detail === 'operational' ? 'Operational detail' : 'High-level summary'}
        </p>
        {email ? (
          <p>Email reports are prepared for your review in Outbox. Sky does not send email.</p>
        ) : (
          <Select
            label="How should this update reach them?"
            value={mode}
            onChange={(value) => setMode(value as ReportDeliverySettings['mode'])}
            data={[
              { value: 'review', label: 'Prepare the report for my review' },
              { value: 'send', label: 'Sky sends the recurring report to this destination' },
            ]}
          />
        )}
        <DeliveryTargetFields medium={policy.medium} value={fields} onChange={setFields} />
        {!email && (
          <NumberInput
            label="Maximum deliveries per day"
            min={1}
            max={24}
            value={maxPerDay}
            onChange={(value) => setMaxPerDay(Number(value) || 1)}
          />
        )}
        {policy.artifacts.length > 0 && (
          <div className="sky-workstream-delivery-scope">
            <strong>Required artifacts</strong>
            <p>{policy.artifacts.join(' + ')}</p>
            <p className="sky-workstream-hint">
              {email
                ? 'Add artifact links to the reporting arrangement before preparing the report.'
                : 'Delivery waits until these artifacts have real links. Add links to the reporting arrangement or when reviewing an update.'}
            </p>
          </div>
        )}
        {!email && (
          <p className="sky-workstream-hint">
            {mode === 'send'
              ? 'Saving authorizes recurring delivery to this exact destination using this audience’s selected sources and information permissions.'
              : 'Sky prepares the update. Sending each report remains your choice.'}
          </p>
        )}
        {error && (
          <p className="sky-workstreams-error" role="alert">
            {error}
          </p>
        )}
        <Button variant="primary" disabled={busy} onClick={save}>
          {mode === 'send' ? 'Authorize recurring delivery' : 'Save review preference'}
        </Button>
      </div>
    </Modal>
  )
}

function ReportReview({
  item,
  policy,
  busy,
  onClose,
  navigate,
  onSend,
}: {
  item: ReportDeliveryRecord
  policy?: Reporting
  busy: boolean
  onClose: () => void
  navigate: (path: string) => void
  onSend: (target: ReportDeliveryTarget | undefined, attachments: ReportDeliveryAttachment[]) => void
}) {
  const [fields, setFields] = useState(() => targetFields(item.target))
  const [attachments, setAttachments] = useState<ReportDeliveryAttachment[]>(() => [
    ...item.attachments,
    ...(policy?.artifacts ?? [])
      .filter((name) => !item.attachments.some((attachment) => attachment.name.toLowerCase() === name.toLowerCase()))
      .map((name) => ({
        name,
        url: policy?.attachments?.find((attachment) => attachment.name.toLowerCase() === name.toLowerCase())?.url ?? '',
      })),
  ])
  const [error, setError] = useState('')
  const canSend = canSendReport(item, policy?.medium)
  const medium = item.target?.medium ?? policy?.medium ?? 'document'
  const email = item.target?.medium === 'email' || policy?.medium === 'email'
  const send = () => {
    if (!canSend) return
    try {
      const target = readTarget(medium, fields)
      if (!target) throw new Error('Choose the exact destination for this report.')
      for (const attachment of attachments)
        if (!attachment.name.trim() || new URL(attachment.url).protocol !== 'https:')
          throw new Error('Add an HTTPS link for every required artifact.')
      onSend(target, attachments)
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Check the destination and artifact links.')
    }
  }
  return (
    <Modal opened onClose={onClose} title={item.title} size="xl">
      <div className="sky-workstream-edit">
        <p>{reportDeliveryStatus(item)}</p>
        <RenderedHtml className="sky-workstream-prose" html={renderStatic(item.body)} />
        {canSend ? (
          <>
            <DeliveryTargetFields medium={medium} value={fields} onChange={setFields} />
            <section>
              <h3>Artifacts to include</h3>
              {attachments.map((attachment, index) => (
                <div className="sky-workstream-edit-card" key={index}>
                  <div className="sky-workstream-row">
                    <TextInput
                      label="Artifact"
                      value={attachment.name}
                      onChange={(event) => {
                        const name = event.currentTarget.value
                        setAttachments(
                          attachments.map((value, offset) => (offset === index ? { ...value, name } : value)),
                        )
                      }}
                    />
                    <ActionIcon
                      aria-label="Remove artifact link"
                      onClick={() => setAttachments(attachments.filter((_, offset) => offset !== index))}
                    >
                      ×
                    </ActionIcon>
                  </div>
                  <TextInput
                    label="Link"
                    type="url"
                    value={attachment.url}
                    onChange={(event) => {
                      const url = event.currentTarget.value
                      setAttachments(attachments.map((value, offset) => (offset === index ? { ...value, url } : value)))
                    }}
                  />
                </div>
              ))}
              <Button size="sm" onClick={() => setAttachments([...attachments, { name: '', url: '' }])}>
                ＋ Artifact link
              </Button>
            </section>
            {error && (
              <p className="sky-workstreams-error" role="alert">
                {error}
              </p>
            )}
            <Button variant="primary" disabled={busy} onClick={send}>
              Approve & send this report
            </Button>
          </>
        ) : (
          <>
            <p>{describeReportTarget(item.target)}</p>
            {email && (
              <>
                <p className="sky-workstream-hint">Sky prepares email reports for review and does not send email.</p>
                {item.outboxId && (
                  <Button
                    size="sm"
                    onClick={() => {
                      onClose()
                      navigate(outboxHref(item.outboxId!))
                    }}
                  >
                    Open in Outbox ↗
                  </Button>
                )}
              </>
            )}
            {item.receipt && (
              <a href={item.receipt.url} target="_blank" rel="noreferrer">
                View delivered report ↗
              </a>
            )}
            {item.status === 'unknown' && (
              <p className="sky-workstream-hint">
                The provider’s result is uncertain. Check delivery before taking another action.
              </p>
            )}
            {item.attachments.map((attachment) => (
              <a key={attachment.name} href={attachment.url} target="_blank" rel="noreferrer">
                {attachment.name} ↗
              </a>
            ))}
          </>
        )}
      </div>
    </Modal>
  )
}
