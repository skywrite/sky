/** The note as markdown: the whole file, front matter included, edited as plain text. */

import { Button, Textarea } from '@mantine/core'
import { useState } from 'react'
import { FormatIcon } from './FormatIcon.tsx'

export function NoteSource({
  text,
  path,
  onChange,
}: {
  text: string
  /** The note's file, once it has one */
  path: string | null
  onChange: (text: string) => void
}) {
  const [copied, setCopied] = useState<'copied' | 'failed' | null>(null)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied('copied')
    } catch {
      setCopied('failed')
    }
    window.setTimeout(() => setCopied(null), 2000)
  }
  return (
    <div className="sky-note-source">
      <div className="sky-note-file">
        <FormatIcon name="file" size={17} />
        <span className="sky-note-file-name">{path ? path.split('/').pop() : 'Not saved yet'}</span>
        <Button size="compact-sm" leftSection={<FormatIcon name="copy" size={16} />} onClick={() => void copy()}>
          {copied === 'copied' ? 'Copied' : copied === 'failed' ? 'Could not copy' : 'Copy Markdown'}
        </Button>
      </div>
      <Textarea
        variant="unstyled"
        autosize
        minRows={14}
        value={text}
        onChange={(event) => onChange(event.currentTarget.value)}
        aria-label="Markdown"
        spellCheck={false}
        classNames={{ input: 'sky-note-source-input' }}
      />
    </div>
  )
}
