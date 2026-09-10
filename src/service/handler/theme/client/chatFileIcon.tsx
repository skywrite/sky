type FileKind = 'pdf' | 'word' | 'sheet' | 'slides' | 'archive' | 'text' | 'image' | 'file'

function fileKind(file: { name: string; type?: string }): FileKind {
  const mime = file.type?.toLowerCase() ?? ''
  const extension = file.name.split('.').at(-1)?.toLowerCase()
  if (mime === 'application/pdf' || extension === 'pdf') return 'pdf'
  if (/msword|wordprocessingml/.test(mime) || /^(docx?|odt|rtf)$/.test(extension ?? '')) return 'word'
  if (/spreadsheet|excel/.test(mime) || /^(xlsx?|csv|ods|numbers)$/.test(extension ?? '')) return 'sheet'
  if (/presentation|powerpoint/.test(mime) || /^(pptx?|odp|key)$/.test(extension ?? '')) return 'slides'
  if (/zip|compressed|archive/.test(mime) || /^(zip|gz|tar|rar|7z)$/.test(extension ?? '')) return 'archive'
  if (mime.startsWith('image/') || /^(png|jpe?g|webp|gif|avif|bmp|ico|heic|heif|svg)$/.test(extension ?? ''))
    return 'image'
  if (mime.startsWith('text/') || /^(txt|md|json|xml|log)$/.test(extension ?? '')) return 'text'
  return 'file'
}

/** File-format marks stay legible at attachment size; photos use their own thumbnails. */
export function ChatFileIcon({ file }: { file: { name: string; type?: string } }) {
  const kind = fileKind(file)
  const label = { pdf: 'PDF', word: 'W', sheet: 'X', slides: 'P', archive: 'ZIP', text: 'TXT', image: '', file: '' }[
    kind
  ]
  return (
    <svg className="sky-chat-file-icon" data-kind={kind} width="32" height="38" viewBox="0 0 32 38" aria-hidden="true">
      <path
        d="M8 2h12l9 9v23a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z"
        fill="currentColor"
        fillOpacity=".07"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path d="M20 2v7a2 2 0 0 0 2 2h7" fill="none" stroke="currentColor" strokeWidth="1.3" />
      {kind === 'word' ? (
        <>
          <path d="M20 17h5m-5 5h5m-5 5h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <rect x="1" y="13" width="17" height="18" rx="3" fill="currentColor" />
          <text
            x="9.5"
            y="26"
            textAnchor="middle"
            fill="white"
            fontFamily="system-ui, sans-serif"
            fontSize="12"
            fontWeight="700"
          >
            W
          </text>
        </>
      ) : label ? (
        <>
          <rect x="1" y="18" width="28" height="13" rx="3" fill="currentColor" />
          <text
            x="15"
            y="27.5"
            textAnchor="middle"
            fill="white"
            fontFamily="system-ui, sans-serif"
            fontSize="8.5"
            fontWeight="700"
          >
            {label}
          </text>
        </>
      ) : kind === 'image' ? (
        <>
          <circle cx="13" cy="19" r="2" fill="currentColor" />
          <path d="m10 29 5-6 3 3 4-5 3 8Z" fill="currentColor" fillOpacity=".7" />
        </>
      ) : (
        <path d="M11 19h13m-13 5h13m-13 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      )}
    </svg>
  )
}
