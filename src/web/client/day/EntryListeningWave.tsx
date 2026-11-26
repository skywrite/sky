import { useEffect, useRef } from 'react'

export function EntryListeningWave({ sample }: { sample: () => number }) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const wave = ref.current!
    let level = 0
    let shown = 0
    let hearing = false
    const timer = window.setInterval(() => {
      const input = sample()
      // Rise on a syllable and decay between syllables without flickering at the noise floor.
      level = Math.max(input, level * 0.74)
      const next = Math.round(level * 50) / 50
      if (next !== shown) {
        wave.style.setProperty('--sky-entry-level', String(next))
        shown = next
      }
      const voiced = level > (hearing ? 0.12 : 0.22)
      if (hearing !== voiced) {
        hearing = voiced
        wave.dataset.hearing = String(hearing)
      }
    }, 50)
    return () => window.clearInterval(timer)
  }, [sample])
  return (
    <span ref={ref} className="sky-entry-wave" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
      <i />
    </span>
  )
}
