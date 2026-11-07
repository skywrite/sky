import { ActionIcon, Button, Modal, Select, Textarea } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { useEffect, useState, type PointerEvent } from 'react'
import {
  MAX_IMAGE_MARKS,
  MAX_MARK_POINTS,
  MAX_MARKUP_PIXELS,
  type ImageMark,
  type ImageMarkup,
  type MarkupPoint,
} from '#universal/ai/imageMarkup.ts'
import { useDialogTitle } from '../lib/useDialogTitle.ts'
import { ImageMarkupOverlay } from './ImageMarkupOverlay.tsx'
import './ImageMarkupEditor.css'

export function ImageMarkupEditor({
  file,
  markup,
  onChange,
  onClose,
  saving,
  error: saveError,
}: {
  file: File
  markup?: ImageMarkup
  onChange: (markup: ImageMarkup) => void
  onClose: () => void
  saving: boolean
  error: string | null
}) {
  const phone = useMediaQuery('(max-width: 700px)')
  useDialogTitle(`sky · Mark up ${file.name}`)
  const [url, setUrl] = useState('')
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tool, setTool] = useState<ImageMark['kind']>('circle')
  const [drawing, setDrawing] = useState<ImageMark | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  useEffect(() => {
    const objectUrl = URL.createObjectURL(file)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [file])
  const value: ImageMarkup | null =
    markup ?? (dimensions && { ...dimensions, marks: [], instruction: '', format: 'png' })
  const ready = !!value && !!dimensions && !error
  const update = (patch: Partial<ImageMarkup>) => {
    if (value) onChange({ ...value, ...patch })
  }
  const add = (mark: ImageMark) => {
    if (!ready || value.marks.length >= MAX_IMAGE_MARKS) return
    update({ marks: [...value.marks, mark] })
    setSelected(value.marks.length)
  }
  const point = (event: PointerEvent<SVGSVGElement>): MarkupPoint => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    }
  }
  const remove = (index: number) => {
    update({ marks: value!.marks.filter((_, i) => i !== index) })
    setSelected(null)
  }
  return (
    <Modal
      opened
      onClose={onClose}
      title="Mark up photo"
      size="min(1180px, 96vw)"
      fullScreen={phone}
      classNames={{ body: 'sky-markup-body' }}
    >
      <p className="sky-markup-intro">Point to what you want to change. Your original photo stays intact.</p>
      <div className="sky-markup-layout">
        <div className="sky-markup-workspace">
          <div className="sky-markup-tools" role="toolbar" aria-label="Photo markup tools">
            {(['circle', 'arrow', 'draw'] as const).map((kind) => (
              <Button
                key={kind}
                variant={tool === kind ? 'primary' : 'secondary'}
                aria-pressed={tool === kind}
                disabled={!ready}
                onClick={() => setTool(kind)}
              >
                {kind === 'circle' ? '◯ Circle' : kind === 'arrow' ? '↗ Arrow' : '〰 Draw'}
              </Button>
            ))}
            <Button
              variant="secondary"
              disabled={!ready || !value.marks.length}
              onClick={() => remove(value!.marks.length - 1)}
            >
              Undo
            </Button>
          </div>
          <div className="sky-markup-stage">
            <div
              className="sky-markup-photo"
              style={
                dimensions
                  ? {
                      aspectRatio: `${dimensions.width}/${dimensions.height}`,
                      maxWidth: `calc(46vh * ${dimensions.width / dimensions.height})`,
                    }
                  : undefined
              }
            >
              {url && (
                <img
                  src={url}
                  alt={file.name}
                  draggable={false}
                  onError={() => setError(`${file.name} could not be opened. Try attaching a PNG, JPEG or WebP copy.`)}
                  onLoad={(event) => {
                    const { naturalWidth: width, naturalHeight: height } = event.currentTarget
                    if (width * height > MAX_MARKUP_PIXELS)
                      setError(`${file.name} is too large to mark up. Attach a copy of 16 megapixels or less.`)
                    else if (markup && (markup.width !== width || markup.height !== height))
                      setError(
                        `The saved marks do not match ${file.name}. Remove this attachment and attach the original again.`,
                      )
                    else setDimensions({ width, height })
                  }}
                />
              )}
              {ready && (
                <ImageMarkupOverlay
                  markup={drawing ? { ...value, marks: [...value.marks, drawing] } : value}
                  className="sky-markup-canvas"
                  role="img"
                  aria-label="Photo annotation canvas. Drag to draw; or use Add mark for keyboard entry."
                  onPointerDown={(event) => {
                    if (!event.isPrimary || event.button !== 0 || value.marks.length >= MAX_IMAGE_MARKS || drawing)
                      return
                    event.preventDefault()
                    event.currentTarget.setPointerCapture(event.pointerId)
                    const start = point(event)
                    setDrawing({ kind: tool, points: [start, start], instruction: '' })
                  }}
                  onPointerMove={(event) => {
                    if (!drawing) return
                    const next = point(event)
                    setDrawing({
                      ...drawing,
                      points:
                        drawing.kind === 'draw'
                          ? [...drawing.points.slice(0, MAX_MARK_POINTS - 1), next]
                          : [drawing.points[0]!, next],
                    })
                  }}
                  onPointerUp={(event) => {
                    if (!drawing) return
                    const end = point(event)
                    const start = drawing.points[0]!
                    if (Math.hypot(end.x - start.x, end.y - start.y) > 0.008)
                      add({
                        ...drawing,
                        points:
                          drawing.kind === 'draw'
                            ? [...drawing.points.slice(0, MAX_MARK_POINTS - 1), end]
                            : [start, end],
                      })
                    setDrawing(null)
                    event.currentTarget.releasePointerCapture(event.pointerId)
                  }}
                  onPointerCancel={() => setDrawing(null)}
                  onLostPointerCapture={() => setDrawing(null)}
                />
              )}
            </div>
          </div>
          {error ? (
            <p role="alert" className="sky-chat-file-error">
              {error}
            </p>
          ) : (
            <div className="sky-markup-help">
              <span>
                {value?.marks.length === MAX_IMAGE_MARKS
                  ? '20 marks reached. Remove one to add another.'
                  : 'Drag on the photo to add a mark.'}
              </span>
              <Button
                variant="primary-quiet"
                size="sm"
                disabled={!ready || value.marks.length >= MAX_IMAGE_MARKS}
                onClick={() =>
                  add({
                    kind: tool,
                    points: [
                      { x: 0.35, y: 0.35 },
                      { x: 0.65, y: 0.65 },
                    ],
                    instruction: '',
                  })
                }
              >
                Add mark
              </Button>
            </div>
          )}
        </div>
        <div className="sky-markup-instructions">
          <h3>What should change?</h3>
          {!value?.marks.length && (
            <p className="sky-markup-empty">
              Circle an area, point with an arrow, or sketch. Each mark gets its own instruction here.
            </p>
          )}
          {value?.marks.map((mark, index) => (
            <div key={index} className="sky-markup-note" data-selected={selected === index || undefined}>
              <div className="sky-markup-note-head">
                <strong>
                  <span>{index + 1}</span>{' '}
                  {mark.kind === 'circle' ? 'Circled area' : mark.kind === 'arrow' ? 'Arrow' : 'Sketch'}
                </strong>
                <ActionIcon variant="secondary" aria-label={`Remove mark ${index + 1}`} onClick={() => remove(index)}>
                  ×
                </ActionIcon>
              </div>
              <Textarea
                aria-label={`Instruction for mark ${index + 1}`}
                placeholder="What should change here?"
                autosize
                minRows={2}
                maxRows={5}
                maxLength={2000}
                value={mark.instruction}
                onFocus={() => setSelected(index)}
                onChange={(event) =>
                  update({
                    marks: value.marks.map((m, i) =>
                      i === index ? { ...m, instruction: event.currentTarget.value } : m,
                    ),
                  })
                }
              />
            </div>
          ))}
          <Textarea
            label="Overall instructions"
            placeholder="Anything else to change or keep?"
            autosize
            minRows={2}
            maxRows={5}
            maxLength={4000}
            disabled={!ready}
            value={value?.instruction ?? ''}
            onChange={(event) => update({ instruction: event.currentTarget.value })}
          />
          <Select
            label="Save as"
            data={[
              { value: 'png', label: 'PNG · best for detail' },
              { value: 'jpeg', label: 'JPEG · smaller photo' },
              { value: 'webp', label: 'WebP · for the web' },
            ]}
            value={value?.format ?? 'png'}
            disabled={!ready}
            onChange={(format) => {
              if (format) update({ format: format as ImageMarkup['format'] })
            }}
            allowDeselect={false}
          />
          <p className="sky-markup-format-note">For a new GIF or SVG, ask in chat.</p>
        </div>
      </div>
      <div className="sky-markup-footer">
        <p role={saveError ? 'alert' : 'status'}>
          {saveError ??
            (saving ? 'Saving marks with your draft…' : 'Done returns to your draft. Send when you’re ready.')}
        </p>
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </div>
    </Modal>
  )
}
