export function KeyStatus({ configured }: { configured: boolean }) {
  return (
    <span className="sky-model-key" data-configured={configured}>
      {configured ? 'Key configured' : 'API key needed'}
    </span>
  )
}
