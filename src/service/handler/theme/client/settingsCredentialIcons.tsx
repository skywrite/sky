export type CredentialIconName =
  | 'key'
  | 'chevron'
  | 'search'
  | 'plus'
  | 'lock'
  | 'code'
  | 'passkey'
  | 'copy'
  | 'eye'
  | 'info'
  | 'check'
  | 'external'
  | 'refresh'

export function CredentialIcon({ name, size = 20 }: { name: CredentialIconName; size?: number }) {
  const paths = {
    key: (
      <>
        <circle cx="8" cy="8" r="4.5" />
        <path d="m11.3 11.3 9.2 9.2M17 17l3-3M14 14l2.5-2.5" />
      </>
    ),
    chevron: <path d="m9 5 7 7-7 7" />,
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 4.5 4.5" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    lock: (
      <>
        <rect x="5" y="10" width="14" height="11" rx="3" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
      </>
    ),
    code: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    passkey: (
      <>
        <circle cx="8" cy="7" r="3" />
        <path d="M2 19v-2a6 6 0 0 1 9-5" />
        <circle cx="17" cy="13" r="3" />
        <path d="M17 16v6m0-3h3" />
      </>
    ),
    copy: (
      <>
        <rect x="8" y="8" width="12" height="13" rx="2" />
        <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3" />
      </>
    ),
    eye: (
      <>
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6M12 7h.01" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    external: (
      <>
        <path d="M14 3h7v7m0-7L10 14M10 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-5" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 7v5h-5M4 17v-5h5M5.3 7a8 8 0 0 1 13-2L20 8M4 16l1.7 3a8 8 0 0 0 13-2" />
      </>
    ),
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  )
}

export function CredentialProviderIcon({ provider }: { provider: 'keychain' | '1password' }) {
  return (
    <div className="sky-cred-provider-icon" data-provider={provider}>
      {provider === '1password' ? (
        <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
          <circle cx="16" cy="16" r="12" fill="none" stroke="currentColor" strokeWidth="2.3" />
          <circle cx="16" cy="12" r="3.8" fill="currentColor" />
          <path d="M13.6 14h4.8v10h-4.8z" fill="currentColor" />
        </svg>
      ) : (
        <CredentialIcon name="key" size={26} />
      )}
    </div>
  )
}
