export interface VoiceTurn {
  who: 'you' | 'sky'
  text: string
  live: boolean
  startMs?: number
  endMs?: number
  interrupted?: boolean
}
interface Fragment {
  who: VoiceTurn['who']
  text: string
  start: number
  end: number
}

/** Live has independent, overlapping transcript streams, with no final-turn event. */
export class LiveTranscript {
  private fragments: Fragment[] = []
  private seen = new Set<string>()

  append(who: Fragment['who'], text: string, start: number, end: number, id?: string): boolean {
    if (!text || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) return false
    if (id && this.seen.has(id)) return false
    if (id) this.seen.add(id)
    // Repeated words are meaningful; only event IDs establish a duplicate.
    this.fragments.push({ who, text, start, end })
    return true
  }

  turns(live = true): VoiceTurn[] {
    const turns: VoiceTurn[] = []
    const last = new Map<Fragment['who'], VoiceTurn>()
    for (const fragment of [...this.fragments].sort((a, b) => a.start - b.start)) {
      let turn = last.get(fragment.who)
      // Group by session time rather than network arrival. Other speakers can
      // acknowledge a thought while this speaker's bubble continues growing.
      if (!turn || fragment.start - turn.endMs! > 1000) {
        if (turn) turn.live = false
        turn = { who: fragment.who, text: '', live, startMs: fragment.start, endMs: fragment.end }
        turns.push(turn)
        last.set(fragment.who, turn)
      }
      turn.text += fragment.text
      turn.endMs = Math.max(turn.endMs!, fragment.end)
    }
    return turns
  }
}
