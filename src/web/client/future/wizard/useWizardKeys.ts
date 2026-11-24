import { useEffect, useRef } from 'react'

/**
 * The wizard without the mouse: a number key picks the choice with that number, and Enter continues.
 * Enter on a choice continues too, since Space is what ticks it; on any other button or link it does
 * what that control does.
 */
export function useWizardKeys(next: () => void): void {
  const latest = useRef(next)
  latest.current = next
  useEffect(() => {
    const press = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return
      const target = event.target as HTMLElement
      if (target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return
      if (event.key === 'Enter') {
        if (target.closest('a, button:not([role="radio"]):not([role="checkbox"])')) return
        event.preventDefault()
        latest.current()
      } else if (/^[1-9]$/.test(event.key)) {
        document.querySelectorAll<HTMLElement>('.sky-wizard [data-wizard-option]')[Number(event.key) - 1]?.click()
      }
    }
    window.addEventListener('keydown', press)
    return () => window.removeEventListener('keydown', press)
  }, [])
}
