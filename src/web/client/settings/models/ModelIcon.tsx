const shapes = {
  chat: (
    <>
      <path d="M7 4h10a4 4 0 0 1 4 4v7a4 4 0 0 1-4 4H9l-5 3v-5a4 4 0 0 1-1-2V8a4 4 0 0 1 4-4Z" />
      <path d="M7 9h10M7 13h6" />
    </>
  ),
  assignments: (
    <>
      <circle cx="6" cy="5" r="2.5" />
      <circle cx="18" cy="5" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      <path d="M8.5 5h7M6 7.5V15a3 3 0 0 0 3 3h6.5" />
    </>
  ),
  decision: <path d="M4 12h5a4 4 0 0 0 4-4V6h7M9 12a4 4 0 0 1 4 4v2h7m-3-15 3 3-3 3m0 6 3 3-3 3" />,
  layers: <path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5m-18 4 9 5 9-5" />,
  frontier: <path d="m2 19 7-12 4 7 3-5 6 10H2Zm5-8 2 1.5 1.8-1" />,
  thinking: <path d="M9 18h6m-5 3h4M8.5 15.5a6.5 6.5 0 1 1 7 0c-.7.5-1 1.2-1.1 2.5H9.6c-.1-1.3-.4-2-1.1-2.5Z" />,
  quick: <path d="m13.3 2-9 11h6.8L10.7 22l9-12h-6.8L13.3 2Z" />,
  balanced: <path d="M12 4v16m-5 0h10M4 7l16-2M6 7l-3 7h6L6 7Zm12-1-3 7h6l-3-7Z" />,
  vision: (
    <>
      <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
  right: <path d="m9 5 7 7-7 7" />,
  pin: (
    <>
      <rect x="5.5" y="10" width="13" height="10.5" rx="2.5" />
      <path d="M8.5 10V7a3.5 3.5 0 1 1 7 0v3" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5m0-9v.15" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  external: <path d="M13 5h6v6m0-6-9 9M11 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />,
}
export type ModelIconName = keyof typeof shapes

export function ModelIcon({ name }: { name: ModelIconName }) {
  return (
    <svg
      className="sky-model-icon"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {shapes[name]}
    </svg>
  )
}
