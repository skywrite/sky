import { Button } from '@mantine/core'
import { Fragment, type RefObject, useMemo, useState } from 'react'
import { FormatIcon } from '../notes/FormatIcon.tsx'
import { tokenizeMarkdown } from './highlightMarkdown.ts'

/**
 * Raw plain-text Markdown tab for the Whiteboard.
 *
 * Renders a native `<textarea>` stacked in the same CSS Grid cell over a
 * character-exact syntax-highlighted `<pre aria-hidden="true">`. All editing,
 * touch selection, paste, and copy stay inside the native `<textarea>`, so
 * pasting strips rich HTML and copying always writes pure `text/plain`.
 */
export function RawEditor({
  text,
  textareaRef,
  onChange,
  onClear,
  onFeedback,
}: {
  text: string
  textareaRef: RefObject<HTMLTextAreaElement | null>
  onChange: (content: string) => void
  onClear: () => void
  onFeedback: (message: string) => void
}) {
  const [copied, setCopied] = useState<'copied' | 'failed' | null>(null)
  const lines = useMemo(() => tokenizeMarkdown(text), [text])
  const words = useMemo(() => {
    const trimmed = text.trim()
    return trimmed ? trimmed.split(/\s+/).length : 0
  }, [text])
  const lineCount = text ? text.split('\n').length : 0

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied('copied')
      onFeedback('Copied plain text')
    } catch {
      setCopied('failed')
      onFeedback('Select text and copy for plain text')
    }
    window.setTimeout(() => setCopied(null), 2000)
  }

  return (
    <>
      <div className="sky-wb-tools-wrap">
        <div className="sky-wb-raw-bar">
          <span className="sky-wb-raw-note">
            <span className="sky-wb-raw-dot" aria-hidden="true" />
            <span className="sky-wb-raw-note-full">
              Plain text only — formatting is stripped on paste and never copied into email.
            </span>
            <span className="sky-wb-raw-note-short">Plain text · safe for email</span>
          </span>
          <div className="sky-wb-raw-actions">
            <Button
              size="compact-sm"
              variant="primary-quiet"
              className="sky-wb-copy-btn"
              data-copied={copied === 'copied' || undefined}
              leftSection={<FormatIcon name="copy" size={16} />}
              disabled={!text}
              onClick={() => void copyAll()}
            >
              <span className="sky-wb-copy-full">
                {copied === 'copied' ? 'Copied plain text' : copied === 'failed' ? 'Could not copy' : 'Copy plain text'}
              </span>
              <span className="sky-wb-copy-short">
                {copied === 'copied' ? 'Copied' : copied === 'failed' ? 'Failed' : 'Copy'}
              </span>
            </Button>
            <Button size="compact-sm" variant="danger-quiet" disabled={!text} onClick={onClear}>
              Clear
            </Button>
          </div>
        </div>
      </div>

      <div className="sky-scroll">
        <div className="sky-doc sky-wb-body">
          <div className="sky-wb-raw-stage">
            <pre className="sky-wb-raw-highlight" aria-hidden="true">
              {lines.map((tokens, lineIndex) => (
                <Fragment key={lineIndex}>
                  {lineIndex > 0 ? '\n' : null}
                  {tokens.map((token, tokenIndex) =>
                    token.kind === 'plain' ? (
                      <Fragment key={tokenIndex}>{token.text}</Fragment>
                    ) : (
                      <span key={tokenIndex} className={`sky-wb-md-${token.kind}`}>
                        {token.text}
                      </span>
                    ),
                  )}
                </Fragment>
              ))}
              {text.endsWith('\n') ? ' ' : null}
            </pre>
            <textarea
              ref={textareaRef}
              className="sky-wb-raw-textarea"
              value={text}
              onChange={(event) => onChange(event.currentTarget.value)}
              onPaste={() => onFeedback('Pasted as plain text')}
              onCopy={() => onFeedback('Copied as plain text')}
              aria-label="Whiteboard raw plain text"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="sentences"
              placeholder="Paste or write plain text here. Rich formatting is stripped automatically on paste, and anything you copy stays plain text — safe for email."
            />
          </div>
          <div className="sky-wb-raw-footer">
            <span>Markdown highlighted · pure text/plain clipboard</span>
            <span>
              {words} {words === 1 ? 'word' : 'words'} · {lineCount} {lineCount === 1 ? 'line' : 'lines'}
            </span>
          </div>
        </div>
      </div>
    </>
  )
}
