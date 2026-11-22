import { Button, Modal, SegmentedControl, Textarea, TextInput } from '@mantine/core'
import { useState } from 'react'
import type { FutureMutation } from '../../../service/handler/future/types.ts'
import { futureRequest } from './request.ts'

/** A new goal: what it is, by when, which part of life it belongs to, and why it matters. */
export function AddGoalDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (name: string) => Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [category, setCategory] = useState('Personal')
  const [why, setWhy] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <Modal opened onClose={onClose} title="Add a goal" size="md" closeOnClickOutside={!busy} closeOnEscape={!busy}>
      <form
        className="sky-future-form"
        onSubmit={async (event) => {
          event.preventDefault()
          if (!title.trim() || busy) return
          setBusy(true)
          setError('')
          try {
            const created = await futureRequest<FutureMutation>('/goals', {
              title: title.trim(),
              category,
              why: why.trim(),
              due: due || null,
            })
            await onCreated(created.name)
          } catch (problem) {
            setError((problem as Error).message)
            setBusy(false)
          }
        }}
      >
        <p className="sky-future-form-intro">
          One outcome you want. Sky keeps it in view in every chat and when it picks what matters each day.
        </p>
        <TextInput
          label="What do you want?"
          placeholder="e.g. Run a marathon"
          value={title}
          onChange={(event) => setTitle(event.currentTarget.value)}
          maxLength={160}
          data-autofocus
        />
        <TextInput
          label="By when?"
          description="Leave empty for no date."
          type="date"
          value={due}
          onChange={(event) => setDue(event.currentTarget.value)}
        />
        <div>
          <div className="sky-future-form-label" id="sky-future-area-label">
            Part of life
          </div>
          <SegmentedControl
            aria-labelledby="sky-future-area-label"
            data={['Personal', 'Professional']}
            value={category}
            onChange={setCategory}
          />
        </div>
        <Textarea
          label="Why does it matter?"
          description="Optional. A few lines in your own words."
          size="sm"
          autosize
          minRows={3}
          value={why}
          onChange={(event) => setWhy(event.currentTarget.value)}
        />
        {error && (
          <p className="sky-future-form-error" role="alert">
            {error}
          </p>
        )}
        <div className="sky-dialog-actions">
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" loading={busy} disabled={!title.trim()}>
            Add goal
          </Button>
        </div>
      </form>
    </Modal>
  )
}
