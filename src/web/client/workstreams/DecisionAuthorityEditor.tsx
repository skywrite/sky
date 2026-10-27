import { ActionIcon, Button, Checkbox, Modal, NumberInput, Select, Switch, Textarea, TextInput } from '@mantine/core'
import { useState } from 'react'
import {
  DecisionAssumptionSchema,
  DecisionPolicySchema,
  type DecisionAssumption,
  type DecisionPolicy,
} from '#lib/workstreams/decisionPolicy.ts'
import type { WorkstreamRecord } from '#lib/workstreams/types.ts'
import type { DecisionWork } from './delegation.ts'

export function DecisionAuthorityEditor({
  item,
  activity,
  policy,
  busy,
  onClose,
  onSave,
}: {
  item: WorkstreamRecord
  activity: DecisionWork
  policy?: DecisionPolicy
  busy: boolean
  onClose: () => void
  onSave: (policy: DecisionPolicy, assumptions: DecisionAssumption[]) => void
}) {
  const [draft, setDraft] = useState(() => DecisionPolicySchema.parse(policy ?? {}))
  const [assumptions, setAssumptions] = useState(activity.decisionAssumptions ?? [])
  const [error, setError] = useState('')
  const change = (patch: Partial<DecisionPolicy>) => setDraft({ ...draft, ...patch })
  const assumptionChange = (id: string, patch: Partial<DecisionAssumption>) =>
    setAssumptions(assumptions.map((value) => (value.id === id ? { ...value, ...patch } : value)))
  const save = () => {
    const parsed = DecisionPolicySchema.safeParse(draft)
    if (!parsed.success) {
      setError(parsed.error.issues.map((issue) => issue.message).join(' '))
      return
    }
    if (parsed.data.mode === 'delegate' && (!parsed.data.instruction.trim() || !parsed.data.options.length)) {
      setError('Give Sky a scope instruction and at least one permitted choice.')
      return
    }
    if (assumptions.some((assumption) => !assumption.statement.trim())) {
      setError('Describe each assumption or remove the empty row.')
      return
    }
    onSave(parsed.data, assumptions)
  }
  return (
    <Modal opened onClose={onClose} title="Who should make this decision?" size="xl">
      <div className="sky-workstream-edit">
        <strong>{activity.title}</strong>
        <Select
          label="Decision responsibility"
          value={draft.mode}
          onChange={(mode) => change({ mode: mode as DecisionPolicy['mode'] })}
          data={[
            { value: 'human', label: 'I’ll decide' },
            { value: 'recommend', label: 'Sky recommends · I decide' },
            { value: 'delegate', label: 'Sky may decide within the boundaries below' },
          ]}
        />
        <Textarea
          label="Context and boundaries"
          description="What matters, what tradeoffs are acceptable, and when should Sky bring it back to you?"
          autosize
          minRows={4}
          value={draft.instruction}
          onChange={(event) => change({ instruction: event.currentTarget.value })}
        />
        <section>
          <h3>Permitted choices</h3>
          {draft.options.map((option, index) => (
            <div className="sky-workstream-edit-card" key={option.id}>
              <div className="sky-workstream-row">
                <TextInput
                  label="Choice"
                  value={option.label}
                  onChange={(event) => {
                    const label = event.currentTarget.value
                    change({
                      options: draft.options.map((value, offset) => (offset === index ? { ...value, label } : value)),
                    })
                  }}
                />
                <ActionIcon
                  aria-label="Remove choice"
                  onClick={() => change({ options: draft.options.filter((_, offset) => offset !== index) })}
                >
                  ×
                </ActionIcon>
              </div>
              <Select
                label="Risk of this choice"
                value={option.risk}
                data={['low', 'medium', 'high']}
                onChange={(risk) =>
                  change({
                    options: draft.options.map((value, offset) =>
                      offset === index ? { ...value, risk: risk as typeof option.risk } : value,
                    ),
                  })
                }
              />
              <details className="sky-workstream-disclosure">
                <summary>Monetary amount, if relevant</summary>
                <div className="sky-workstream-form-grid">
                  <NumberInput
                    label="Amount"
                    min={0}
                    value={option.amount ?? ''}
                    onChange={(amount) =>
                      change({
                        options: draft.options.map((value, offset) =>
                          offset === index ? { ...value, amount: amount === '' ? undefined : Number(amount) } : value,
                        ),
                      })
                    }
                  />
                  <TextInput
                    label="Currency"
                    placeholder="USD"
                    value={option.currency ?? ''}
                    onChange={(event) => {
                      const currency = event.currentTarget.value.toUpperCase()
                      change({
                        options: draft.options.map((value, offset) =>
                          offset === index ? { ...value, currency: currency || undefined } : value,
                        ),
                      })
                    }}
                  />
                </div>
              </details>
            </div>
          ))}
          <Button
            size="sm"
            onClick={() => change({ options: [...draft.options, { id: crypto.randomUUID(), label: '', risk: 'low' }] })}
          >
            ＋ Choice
          </Button>
        </section>
        <section>
          <h3>Assumptions behind the decision</h3>
          {assumptions.map((assumption) => (
            <div className="sky-workstream-edit-card" key={assumption.id}>
              <div className="sky-workstream-row">
                <Textarea
                  label="Assumption"
                  autosize
                  minRows={2}
                  value={assumption.statement}
                  onChange={(event) =>
                    assumptionChange(assumption.id, {
                      statement: event.currentTarget.value,
                      status: 'unconfirmed',
                      confirmedBy: undefined,
                      sourceVersions: {},
                    })
                  }
                />
                <ActionIcon
                  aria-label="Remove assumption"
                  onClick={() => {
                    setAssumptions(assumptions.filter((value) => value.id !== assumption.id))
                    change({ requiredAssumptionIds: draft.requiredAssumptionIds.filter((id) => id !== assumption.id) })
                  }}
                >
                  ×
                </ActionIcon>
              </div>
              <Select
                label="What do we know?"
                value={assumption.status}
                data={[
                  { value: 'unconfirmed', label: 'Not yet confirmed' },
                  { value: 'confirmed', label: 'I confirm this assumption' },
                  { value: 'rejected', label: 'This assumption is false' },
                ]}
                onChange={(status) =>
                  assumptionChange(assumption.id, {
                    status: status as DecisionAssumption['status'],
                    confirmedBy: status === 'confirmed' ? 'owner' : undefined,
                  })
                }
              />
              <div className="sky-workstream-source-permissions">
                {item.sources.map((source) => (
                  <Checkbox
                    key={source.id}
                    label={source.label || source.path}
                    checked={assumption.sourceIds.includes(source.id)}
                    onChange={(event) =>
                      assumptionChange(assumption.id, {
                        sourceIds: event.currentTarget.checked
                          ? [...assumption.sourceIds, source.id]
                          : assumption.sourceIds.filter((id) => id !== source.id),
                        sourceVersions: {},
                        status: 'unconfirmed',
                        confirmedBy: undefined,
                      })
                    }
                  />
                ))}
              </div>
              <Checkbox
                label="Required for this decision"
                checked={draft.requiredAssumptionIds.includes(assumption.id)}
                onChange={(event) =>
                  change({
                    requiredAssumptionIds: event.currentTarget.checked
                      ? [...draft.requiredAssumptionIds, assumption.id]
                      : draft.requiredAssumptionIds.filter((id) => id !== assumption.id),
                  })
                }
              />
            </div>
          ))}
          <Button
            size="sm"
            onClick={() =>
              setAssumptions([
                ...assumptions,
                DecisionAssumptionSchema.parse({ id: crypto.randomUUID(), statement: ' ' }),
              ])
            }
          >
            ＋ Assumption
          </Button>
        </section>
        <div className="sky-workstream-form-grid">
          <section className="sky-workstream-source-permissions">
            <h3>Required sources</h3>
            {item.sources.map((source) => (
              <Checkbox
                key={source.id}
                label={source.label || source.path}
                checked={draft.requiredSourceIds.includes(source.id)}
                onChange={(event) =>
                  change({
                    requiredSourceIds: event.currentTarget.checked
                      ? [...draft.requiredSourceIds, source.id]
                      : draft.requiredSourceIds.filter((id) => id !== source.id),
                  })
                }
              />
            ))}
            {!item.sources.length && (
              <p className="sky-workstream-hint">Add supporting sources in workstream details.</p>
            )}
          </section>
          <section className="sky-workstream-source-permissions">
            <h3>Required stakeholder input</h3>
            {item.stakeholders.map((person) => (
              <Checkbox
                key={person.id}
                label={person.name}
                checked={draft.requiredStakeholderIds.includes(person.id)}
                onChange={(event) =>
                  change({
                    requiredStakeholderIds: event.currentTarget.checked
                      ? [...draft.requiredStakeholderIds, person.id]
                      : draft.requiredStakeholderIds.filter((id) => id !== person.id),
                  })
                }
              />
            ))}
            {!item.stakeholders.length && (
              <p className="sky-workstream-hint">Add stakeholders when their input is needed.</p>
            )}
          </section>
        </div>
        {draft.mode === 'delegate' && (
          <>
            <div className="sky-workstream-form-grid">
              <Select
                label="Maximum permitted risk"
                value={draft.maxRisk}
                data={['low', 'medium', 'high']}
                onChange={(maxRisk) => change({ maxRisk: maxRisk as DecisionPolicy['maxRisk'] })}
              />
              <NumberInput
                label="Minimum confidence (%)"
                min={0}
                max={100}
                value={Math.round(draft.minConfidence * 100)}
                onChange={(value) => change({ minConfidence: Number(value) / 100 })}
              />
              <NumberInput
                label="Maximum amount, if relevant"
                min={0}
                value={draft.maxAmount ?? ''}
                onChange={(value) => change({ maxAmount: value === '' ? undefined : Number(value) })}
              />
              <TextInput
                label="Currency"
                placeholder="USD"
                value={draft.currency ?? ''}
                onChange={(event) => change({ currency: event.currentTarget.value.toUpperCase() || undefined })}
              />
            </div>
            <Switch
              label="Sky may proceed with unconfirmed assumptions"
              checked={draft.allowUnconfirmedAssumptions}
              onChange={(event) => change({ allowUnconfirmedAssumptions: event.currentTarget.checked })}
            />
            <TextInput
              label="Authority expires, if useful (UTC)"
              type="datetime-local"
              value={draft.expiresAt?.replace(' ', 'T').slice(0, 16) ?? ''}
              onChange={(event) => change({ expiresAt: event.currentTarget.value || undefined })}
            />
            <p className="sky-workstream-hint">
              Sky may record one of these choices when the evidence and boundaries above are satisfied. Missing input,
              contradictions, and choices outside this scope come back to you.
            </p>
          </>
        )}
        {error && (
          <p role="alert" className="sky-workstreams-error">
            {error}
          </p>
        )}
        <Button variant="primary" disabled={busy} onClick={save}>
          {draft.mode === 'delegate' ? 'Delegate this decision' : 'Save decision responsibility'}
        </Button>
      </div>
    </Modal>
  )
}
