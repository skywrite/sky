import { ActionIcon, Button, Checkbox, Modal, NumberInput, Select, Switch, Textarea, TextInput } from '@mantine/core'
import { useState } from 'react'
import { ReportingSchema, SourceSchema, type Workstream, type WorkstreamRecord } from '#lib/workstreams/types.ts'

export function DetailsEditor({
  item,
  busy,
  onClose,
  onSave,
}: {
  item: WorkstreamRecord
  busy: boolean
  onClose: () => void
  onSave: (patch: Partial<Workstream>) => void
}) {
  const [people, setPeople] = useState(item.stakeholders)
  const [metrics, setMetrics] = useState(item.metrics)
  const [sources, setSources] = useState(item.sources)
  const [reporting, setReporting] = useState(item.reporting)
  const [artifactText, setArtifactText] = useState<Record<string, string>>(() =>
    Object.fromEntries(item.reporting.map((report) => [report.id, report.artifacts.join(', ')])),
  )
  return (
    <Modal opened onClose={onClose} title="Details that help the work" size="xl">
      <div className="sky-workstream-edit">
        <p>Add what is useful now. These details can develop over time.</p>
        <section>
          <h3>Stakeholders</h3>
          {people.map((person, index) => (
            <div className="sky-workstream-edit-card" key={person.id}>
              <div className="sky-workstream-row">
                <TextInput
                  label="Name"
                  value={person.name}
                  onChange={(event) => {
                    const name = event.currentTarget.value
                    setPeople(people.map((value, offset) => (offset === index ? { ...value, name } : value)))
                  }}
                />
                <ActionIcon
                  aria-label="Remove stakeholder"
                  onClick={() => setPeople(people.filter((_, offset) => offset !== index))}
                >
                  ×
                </ActionIcon>
              </div>
              <div className="sky-workstream-form-grid">
                <TextInput
                  label="Role"
                  placeholder="Approver, contributor, informed…"
                  value={person.role}
                  onChange={(event) => {
                    const role = event.currentTarget.value
                    setPeople(people.map((value, offset) => (offset === index ? { ...value, role } : value)))
                  }}
                />
                <TextInput
                  label="Contact, if useful"
                  value={person.contact}
                  onChange={(event) => {
                    const contact = event.currentTarget.value
                    setPeople(people.map((value, offset) => (offset === index ? { ...value, contact } : value)))
                  }}
                />
              </div>
            </div>
          ))}
          <Button
            size="sm"
            onClick={() => setPeople([...people, { id: crypto.randomUUID(), name: '', role: '', contact: '' }])}
          >
            ＋ Stakeholder
          </Button>
        </section>
        <section>
          <h3>Metrics</h3>
          {metrics.map((metric, index) => (
            <div className="sky-workstream-edit-card" key={metric.id}>
              <div className="sky-workstream-row">
                <TextInput
                  label="What are you measuring?"
                  value={metric.name}
                  onChange={(event) => {
                    const name = event.currentTarget.value
                    setMetrics(metrics.map((value, offset) => (offset === index ? { ...value, name } : value)))
                  }}
                />
                <ActionIcon
                  aria-label="Remove metric"
                  onClick={() => setMetrics(metrics.filter((_, offset) => offset !== index))}
                >
                  ×
                </ActionIcon>
              </div>
              <div className="sky-workstream-form-grid">
                {(['current', 'target', 'unit'] as const).map((field) => (
                  <TextInput
                    key={field}
                    label={field === 'current' ? 'Current' : field === 'target' ? 'Target' : 'Unit'}
                    value={metric[field]}
                    onChange={(event) => {
                      const text = event.currentTarget.value
                      setMetrics(
                        metrics.map((value, offset) => (offset === index ? { ...value, [field]: text } : value)),
                      )
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
          <Button
            size="sm"
            onClick={() =>
              setMetrics([...metrics, { id: crypto.randomUUID(), name: '', target: '', current: '', unit: '' }])
            }
          >
            ＋ Metric
          </Button>
        </section>
        <section>
          <h3>Sources for Sky</h3>
          <p className="sky-workstream-hint">Link notebook documents that give Sky the context it needs.</p>
          {sources.map((source, index) => (
            <div className="sky-workstream-edit-card" key={source.id}>
              <div className="sky-workstream-row">
                <TextInput
                  label="Notebook file"
                  value={source.path}
                  placeholder="Path to a document in your notebook"
                  onChange={(event) => {
                    const path = event.currentTarget.value
                    setSources(sources.map((value, offset) => (offset === index ? { ...value, path } : value)))
                  }}
                />
                <ActionIcon
                  aria-label="Remove source"
                  onClick={() => setSources(sources.filter((_, offset) => offset !== index))}
                >
                  ×
                </ActionIcon>
              </div>
              <TextInput
                label="Label"
                value={source.label}
                onChange={(event) => {
                  const label = event.currentTarget.value
                  setSources(sources.map((value, offset) => (offset === index ? { ...value, label } : value)))
                }}
              />
              <Switch
                label="Contains sensitive information"
                checked={source.sensitive}
                onChange={(event) => {
                  const sensitive = event.currentTarget.checked
                  setSources(sources.map((value, offset) => (offset === index ? { ...value, sensitive } : value)))
                }}
              />
              {people.some((person) => person.name.trim()) && (
                <div className="sky-workstream-source-permissions">
                  <strong>Whose input is in this source?</strong>
                  {people
                    .filter((person) => person.name.trim())
                    .map((person) => (
                      <Checkbox
                        key={person.id}
                        label={person.name}
                        checked={(source.stakeholderIds ?? []).includes(person.id)}
                        onChange={(event) => {
                          const stakeholderIds = event.currentTarget.checked
                            ? [...(source.stakeholderIds ?? []), person.id]
                            : (source.stakeholderIds ?? []).filter((id) => id !== person.id)
                          setSources(
                            sources.map((value, offset) => (offset === index ? { ...value, stakeholderIds } : value)),
                          )
                        }}
                      />
                    ))}
                </div>
              )}
            </div>
          ))}
          <Button
            size="sm"
            onClick={() => setSources([...sources, SourceSchema.parse({ id: crypto.randomUUID(), path: ' ' })])}
          >
            ＋ Source
          </Button>
        </section>
        <section>
          <h3>Reporting</h3>
          <p className="sky-workstream-hint">
            Each audience can have its own cadence, medium, level of detail, and permitted sources.
          </p>
          {reporting.map((report, index) => {
            const change = (patch: Partial<typeof report>) =>
              setReporting(reporting.map((value, offset) => (offset === index ? { ...value, ...patch } : value)))
            return (
              <div className="sky-workstream-edit-card" key={report.id}>
                <div className="sky-workstream-row">
                  <TextInput
                    label="Audience"
                    value={report.audience}
                    onChange={(event) => change({ audience: event.currentTarget.value })}
                  />
                  <ActionIcon
                    aria-label="Remove reporting arrangement"
                    onClick={() => setReporting(reporting.filter((_, offset) => offset !== index))}
                  >
                    ×
                  </ActionIcon>
                </div>
                <div className="sky-workstream-form-grid">
                  <Select
                    label="Medium"
                    value={report.medium}
                    data={['email', 'slack', 'document', 'other']}
                    onChange={(medium) => change({ medium: medium as typeof report.medium })}
                  />
                  <NumberInput
                    label="Every (days)"
                    min={1}
                    max={365}
                    value={report.cadenceDays}
                    onChange={(value) => change({ cadenceDays: Number(value) || 7 })}
                  />
                </div>
                <Select
                  label="Level of detail"
                  value={report.detail}
                  data={[
                    { value: 'summary', label: 'High-level summary' },
                    { value: 'operational', label: 'Operational detail' },
                  ]}
                  onChange={(detail) => change({ detail: detail as typeof report.detail })}
                />
                <TextInput
                  label="Destination"
                  placeholder="A person, channel, or email audience"
                  value={report.destination}
                  onChange={(event) => change({ destination: event.currentTarget.value })}
                />
                <Textarea
                  label="What should this audience receive?"
                  description="Describe the useful level of detail and what should stay out."
                  autosize
                  minRows={3}
                  value={report.instructions}
                  onChange={(event) => change({ instructions: event.currentTarget.value })}
                />
                <TextInput
                  label="Desired artifacts"
                  description="Optional artifacts alongside the written report, separated with commas, such as presentation, Loom video."
                  value={artifactText[report.id] ?? report.artifacts.join(', ')}
                  onChange={(event) => {
                    const text = event.currentTarget.value
                    setArtifactText({ ...artifactText, [report.id]: text })
                    change({
                      artifacts: text
                        .split(',')
                        .map((value) => value.trim())
                        .filter(Boolean),
                    })
                  }}
                />
                {report.artifacts.map((name) => (
                  <TextInput
                    key={name}
                    label={`${name} link`}
                    description="An actual HTTPS link is needed before this artifact can be delivered."
                    type="url"
                    value={
                      report.attachments?.find((attachment) => attachment.name.toLowerCase() === name.toLowerCase())
                        ?.url ?? ''
                    }
                    onChange={(event) => {
                      const url = event.currentTarget.value
                      change({
                        attachments: [
                          ...(report.attachments ?? []).filter(
                            (attachment) => attachment.name.toLowerCase() !== name.toLowerCase(),
                          ),
                          ...(url ? [{ name, url }] : []),
                        ],
                      })
                    }}
                  />
                ))}
                <div className="sky-workstream-source-permissions">
                  <strong>Sources this audience may see</strong>
                  <Checkbox
                    label="Include this workstream · Sensitive"
                    description="Its outcome, progress, decisions, and working notes. The brief may contain mixed private context."
                    checked={sources.some(
                      (source) => source.path === item.path && report.permittedSourceIds.includes(source.id),
                    )}
                    onChange={(event) => {
                      const existing = sources.find((source) => source.path === item.path)
                      if (!event.currentTarget.checked) {
                        if (existing)
                          change({ permittedSourceIds: report.permittedSourceIds.filter((id) => id !== existing.id) })
                        return
                      }
                      const source = existing
                        ? { ...existing, sensitive: true }
                        : SourceSchema.parse({
                            id: crypto.randomUUID(),
                            path: item.path,
                            label: 'This workstream',
                            sensitive: true,
                          })
                      setSources(
                        existing
                          ? sources.map((value) => (value.id === source.id ? source : value))
                          : [...sources, source],
                      )
                      change({ permittedSourceIds: [...new Set([...report.permittedSourceIds, source.id])] })
                    }}
                  />
                  {sources
                    .filter((source) => source.path.trim() && source.path !== item.path)
                    .map((source) => (
                      <Checkbox
                        key={source.id}
                        label={`${source.label || source.path}${source.sensitive ? ' · Sensitive' : ''}`}
                        checked={report.permittedSourceIds.includes(source.id)}
                        onChange={(event) =>
                          change({
                            permittedSourceIds: event.currentTarget.checked
                              ? [...report.permittedSourceIds, source.id]
                              : report.permittedSourceIds.filter((id) => id !== source.id),
                          })
                        }
                      />
                    ))}
                  {!report.allowSensitive &&
                    sources.some((source) => source.sensitive && report.permittedSourceIds.includes(source.id)) && (
                      <p className="sky-workstream-hint">
                        Selected sensitive sources stay excluded until this audience is allowed to receive sensitive
                        information below.
                      </p>
                    )}
                </div>
                <Switch
                  label="This audience may receive sensitive information"
                  checked={report.allowSensitive === true}
                  onChange={(event) => change({ allowSensitive: event.currentTarget.checked })}
                />
              </div>
            )
          })}
          <Button
            size="sm"
            onClick={() =>
              setReporting([...reporting, ReportingSchema.parse({ id: crypto.randomUUID(), audience: ' ' })])
            }
          >
            ＋ Reporting audience
          </Button>
        </section>
        <Button
          variant="primary"
          disabled={busy}
          onClick={() =>
            onSave({
              stakeholders: people.filter((value) => value.name.trim()),
              metrics: metrics.filter((value) => value.name.trim()),
              sources: sources.filter((value) => value.path.trim()),
              reporting: reporting.filter((value) => value.audience.trim()),
            })
          }
        >
          Save details
        </Button>
      </div>
    </Modal>
  )
}
