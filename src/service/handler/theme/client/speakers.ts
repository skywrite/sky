/**
 * The speakers take a moment to be ready for a first word: AirPods switch
 * profiles when a microphone opens, a headset wakes, a route changes. The
 * remote track carries silence from the moment it connects, so waiting
 * until the audio element is really playing it, and then a little longer,
 * settles the route before anything worth hearing is asked for.
 */

/** Silence that flows once the element is playing, before the first word. */
export const SPEAKER_WARMUP_MS = 1000

/** Resolves once `el` reports it is playing and the warm-up has passed; never rejects. */
export function whenSpeakersWarm(el: HTMLMediaElement, warmupMs = SPEAKER_WARMUP_MS): Promise<void> {
  return new Promise((resolve) => {
    const settle = () => window.setTimeout(resolve, warmupMs)
    if (!el.paused && el.currentTime > 0) {
      settle()
      return
    }
    el.addEventListener('playing', settle, { once: true })
  })
}
