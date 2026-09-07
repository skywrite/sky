import type { ReactNode } from 'react'
import type { LinkKind } from '../../links/types.ts'

const ICONS: Record<LinkKind, ReactNode> = {
  person: (
    <>
      <circle cx="12" cy="7" r="3.5" />
      <path d="M5 21v-2a7 7 0 0 1 14 0v2" />
    </>
  ),
  org: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="1" />
      <path d="M9 7h1m4 0h1M9 11h1m4 0h1M10 21v-6h4v6" />
    </>
  ),
  project: <path d="M3 7V5a2 2 0 0 1 2-2h5l3 4h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />,
  video: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m10 9 5 3-5 3Z" />
    </>
  ),
  meeting: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M7 3v4m10-4v4M3 10h18" />
      <circle cx="12" cy="14" r="1.5" />
      <path d="M8 19a4 4 0 0 1 8 0" />
    </>
  ),
  chat: (
    <>
      <path d="M20 11V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12l4-4h5" />
      <path d="M14 11h5a2 2 0 0 1 2 2v8l-3-3h-4a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2Z" />
    </>
  ),
  message: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </>
  ),
  journal: (
    <>
      <rect x="5" y="3" width="15" height="18" rx="2" />
      <path d="M8 3v18M3 7h4m-4 5h4m-4 5h4m5-10h5m-5 4h5" />
    </>
  ),
  note: <path d="M14 3H5v18h14V8l-5-5Zm0 0v5h5M8 12h8m-8 4h6" />,
  day: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M7 3v4m10-4v4M3 10h18m-13 4h2m4 0h2m-8 3h2m4 0h2" />
    </>
  ),
  place: (
    <>
      <path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  library: (
    <>
      <rect x="3" y="4" width="4" height="16" rx="1" />
      <rect x="8" y="4" width="4" height="16" rx="1" />
      <path d="m14 5 4-1 4 15-4 1-4-15Z" />
    </>
  ),
}

export function LinkIcon({ kind }: { kind: LinkKind }) {
  const label = kind === 'org' ? 'Organization' : kind.charAt(0).toUpperCase() + kind.slice(1)
  return (
    <svg
      className="sky-link-icon"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={label}
    >
      <title>{label}</title>
      {ICONS[kind]}
    </svg>
  )
}
