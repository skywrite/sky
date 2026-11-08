import { Button } from '@mantine/core'
import { useEffect, useState } from 'react'

/** Copies the reply as written, in Markdown, like the Copy on a draft. */
export function CopyResponseButton({ text }: { text: string }) {
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle')
  useEffect(() => {
    if (copy === 'idle') return
    const timer = setTimeout(() => setCopy('idle'), copy === 'failed' ? 6000 : 2000)
    return () => clearTimeout(timer)
  }, [copy])
  const copied = copy === 'copied'
  return (
    <>
      {copy === 'failed' && <span role="status">Couldn’t copy. Select the text to copy it.</span>}
      <Button
        size="compact-sm"
        variant="primary-quiet"
        className="sky-reply-action"
        leftSection={
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            aria-hidden="true"
          >
            {copied ? (
              <path d="m5 13 4 4L19 7" />
            ) : (
              <>
                <rect x="9" y="9" width="11" height="11" rx="2" />
                <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
              </>
            )}
          </svg>
        }
        aria-label={copied ? 'Response copied' : 'Copy response'}
        onClick={() => {
          if (!navigator.clipboard) {
            setCopy('failed')
            return
          }
          void navigator.clipboard.writeText(text).then(
            () => setCopy('copied'),
            () => setCopy('failed'),
          )
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </>
  )
}
