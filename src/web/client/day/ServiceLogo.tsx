/**
 * Compact 16x16 messenger/email brand marks for Needs Response rows.
 * Fixed square box keeps every row's sender text aligned in one clean column.
 */
export function ServiceLogo({ service }: { service: string }) {
  const key = service.trim().toLowerCase()

  if (key === 'slack') {
    return (
      <span className="sky-nr-icon" role="img" aria-label="Slack" title="Slack">
        <svg viewBox="0 0 122.8 122.8" aria-hidden="true">
          <path
            fill="#e01e5a"
            d="M25.8 77.6c0 7.1-5.8 12.9-12.9 12.9S0 84.7 0 77.6s5.8-12.9 12.9-12.9h12.9v12.9zm6.5 0c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V77.6z"
          />
          <path
            fill="#36c5f0"
            d="M45.2 25.8c-7.1 0-12.9-5.8-12.9-12.9S38.1 0 45.2 0s12.9 5.8 12.9 12.9v12.9H45.2zm0 6.5c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H12.9C5.8 58.1 0 52.3 0 45.2s5.8-12.9 12.9-12.9h32.3z"
          />
          <path
            fill="#2eb67d"
            d="M97 45.2c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9-5.8 12.9-12.9 12.9H97V45.2zm-6.5 0c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V12.9C64.7 5.8 70.5 0 77.6 0s12.9 5.8 12.9 12.9v32.3z"
          />
          <path
            fill="#ecb22e"
            d="M77.6 97c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9-12.9-5.8-12.9-12.9V97h12.9zm0-6.5c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H77.6z"
          />
        </svg>
      </span>
    )
  }

  if (key === 'gmail' || key === 'email') {
    const label = key === 'email' ? 'Email' : 'Gmail'
    return (
      <span className="sky-nr-icon" role="img" aria-label={label} title={label}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="#4285f4" d="M2 7.5V19a1.5 1.5 0 0 0 1.5 1.5H6V11L2 7.5z" />
          <path fill="#34a853" d="M22 7.5V19a1.5 1.5 0 0 1-1.5 1.5H18V11l4-3.5z" />
          <path fill="#fbbc04" d="M18 11V5.2l2.1-1.5A1.5 1.5 0 0 1 22.5 5v2.5L18 11z" />
          <path fill="#ea4335" d="M6 11V5.2l6 4.5 6-4.5V11l-6 4.5L6 11z" />
          <path fill="#c5221f" d="M1.5 5a1.5 1.5 0 0 1 2.4-1.3L6 5.2V11L1.5 7.5V5z" />
        </svg>
      </span>
    )
  }

  if (key === 'imessage' || key === 'imessage audio' || key === 'sms') {
    const label = key === 'sms' ? 'SMS' : 'iMessage'
    return (
      <span className="sky-nr-icon" role="img" aria-label={label} title={label}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="#007aff"
            d="M12 3C6.8 3 2.5 6.7 2.5 11.3c0 2.6 1.4 5 3.6 6.5-.2 1.4-.9 2.6-1.7 3.3 1.9-.1 3.7-.7 5-1.6.8.2 1.7.3 2.6.3 5.2 0 9.5-3.7 9.5-8.5S17.2 3 12 3z"
          />
        </svg>
      </span>
    )
  }

  if (key === 'whatsapp') {
    return (
      <span className="sky-nr-icon" role="img" aria-label="WhatsApp" title="WhatsApp">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="#25d366" d="M12 2.2A9.7 9.7 0 0 0 3.6 16.8L2.3 21.7l5-1.3A9.7 9.7 0 1 0 12 2.2z" />
          <path
            fill="#ffffff"
            d="M16.8 14.3c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.6.8-.8.9-.3.2-.5.1a7.4 7.4 0 0 1-2.2-1.3 8.2 8.2 0 0 1-1.5-1.9c-.2-.3 0-.4.1-.6l.4-.5.3-.4c.1-.2 0-.3 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.3s-1 1-1 2.4 1 2.7 1.2 2.9 2 3.1 4.9 4.3c.7.3 1.2.5 1.6.6.7.2 1.3.2 1.8.1.5-.1 1.5-.6 1.7-1.2s.2-1.1.1-1.2-.2-.2-.5-.3z"
          />
        </svg>
      </span>
    )
  }

  if (key === 'signal') {
    return (
      <span className="sky-nr-icon" role="img" aria-label="Signal" title="Signal">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9.8" fill="none" stroke="#3a76f0" strokeWidth="1.6" strokeDasharray="3.2 2.4" />
          <path fill="#3a76f0" d="M12 5.2A6.8 6.8 0 0 0 6.1 15.4l-.8 3 3.1-.8A6.8 6.8 0 1 0 12 5.2z" />
        </svg>
      </span>
    )
  }

  if (key === 'telegram') {
    return (
      <span className="sky-nr-icon" role="img" aria-label="Telegram" title="Telegram">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="10" fill="#229ed9" />
          <path
            fill="#ffffff"
            d="M16.9 7.8 6.4 11.9c-.7.3-.7.7-.1.9l2.7.8 6.2-3.9c.3-.2.6-.1.3.1l-5 4.5-.2 2.8c.3 0 .4-.1.6-.3l1.3-1.3 2.7 2c.5.3.9.1 1-.5l1.8-8.5c.2-.7-.3-1-.8-.7z"
          />
        </svg>
      </span>
    )
  }

  const label = service.trim() || 'Message'
  return (
    <span className="sky-nr-icon" role="img" aria-label={label} title={label}>
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          fill="var(--sky-dim)"
          d="M12 3C6.8 3 2.5 6.7 2.5 11.3c0 2.6 1.4 5 3.6 6.5-.2 1.4-.9 2.6-1.7 3.3 1.9-.1 3.7-.7 5-1.6.8.2 1.7.3 2.6.3 5.2 0 9.5-3.7 9.5-8.5S17.2 3 12 3z"
        />
      </svg>
    </span>
  )
}
