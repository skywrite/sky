const icons = {
  today: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  chat: (
    <>
      <path d="M7 4h10a4 4 0 0 1 4 4v7a4 4 0 0 1-4 4H9l-5 3v-5a4 4 0 0 1-1-2V8a4 4 0 0 1 4-4Z" />
      <path d="M7 9h10M7 13h6" />
    </>
  ),
  outbox: <path d="M4 11 3 19a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2l-1-8M3.5 15H8l1.5 3h5l1.5-3h4.5M12 12V2m-4 4 4-4 4 4" />,
  workstreams: (
    <>
      <circle cx="6" cy="5" r="2.5" />
      <circle cx="18" cy="5" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      <path d="M8.5 5h7M6 7.5V15a3 3 0 0 0 3 3h6.5" />
    </>
  ),
}

export function SidebarIcon({ name }: { name: keyof typeof icons }) {
  return (
    <svg
      className="sky-side-icon"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {icons[name]}
    </svg>
  )
}
