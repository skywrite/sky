export type NeedsResponseMedium = 'Slack' | 'Email' | 'Beeper'

export type NeedsResponseKind = 'dm' | 'group' | 'mention' | 'thread' | 'inbox'

export type NeedsResponseTarget =
  | { medium: 'Slack'; link: string }
  | { medium: 'Email'; account: string; thread: string; link: string }
  | { medium: 'Beeper'; account: string; chat: string; network: string }

/** Unscreened inbound conversation waiting on a reply from the owner. */
export interface NeedsResponseCandidate {
  /** Stable conversation key across scans (e.g. `Slack:...`, `Email:...`, `Beeper:...`). */
  id: string
  /** Fingerprint of the latest inbound message; changes whenever a new reply arrives. */
  version: string
  /** User-facing source label (`Slack`, `Gmail`, `iMessage`, `WhatsApp`, ...). */
  source: string
  medium: NeedsResponseMedium
  kind: NeedsResponseKind
  /** Raw sender display name as reported by the source. */
  senderName: string
  /** Optional sender email address for PeopleStore handle resolution. */
  senderEmail?: string
  /** Optional sender phone number/handle for PeopleStore handle resolution. */
  senderPhone?: string
  /** Optional channel/subject label for extra context (e.g. `#atlas` or email subject). */
  contextLabel?: string
  /** Short single-line summary shown in the Today section. */
  summary: string
  /** UTC ISO instant string of when the unanswered inbound message arrived. */
  receivedAt: string
  /** Wall-clock local timestamp (`YYYY-MM-DD HH:MM`) for display. */
  receivedLocal: string
  /** True when the owner already participated earlier in this thread (e.g. started it or replied). */
  ownerParticipated: boolean
  /** True when the capture links via `previous:` to an earlier saved conversation with this contact. */
  hasPriorHistory?: boolean
  /** True when a Beeper capture arrived with a resolved human name (past Beeper's holdUnknown gate). */
  resolvedBeeperName?: boolean
  /** Compact conversation transcript passed to Jev for response screening. */
  transcript: string
  /** Native app destination to open when clicked. */
  target: NeedsResponseTarget | null
  /** Saved notebook capture relative path, used as fallback when no native link exists. */
  savedPath?: string
}

/** Stored active candidate after passing Jev screening and sender resolution. */
export interface StoredNeedsResponseEntry {
  id: string
  version: string
  source: string
  medium: NeedsResponseMedium
  kind: NeedsResponseKind
  senderName: string
  senderEmail?: string
  senderPhone?: string
  contextLabel?: string
  summary: string
  receivedAt: string
  receivedLocal: string
  ownerParticipated: boolean
  hasPriorHistory?: boolean
  resolvedBeeperName?: boolean
  target: NeedsResponseTarget | null
  savedPath?: string
  screen: {
    needsResponse: number
    ownerAddressed: number
  }
}

/** Public item returned to the Today Day view, ranked live by age + person score. */
export interface NeedsResponseItem {
  id: string
  version: string
  source: string
  kind: NeedsResponseKind
  sender: string
  contextLabel?: string
  summary: string
  receivedAt: string
  receivedLocal: string
  ageHours: number
  personScore: number
  /** True when the sender matched a card in Mac Contacts (elevated with bonus ranking points). */
  inMacContacts?: boolean
  priority: number
  /** Direct external URL for Slack / Gmail, or null when opened via native Beeper action or saved capture. */
  href: string | null
  /** Present when clicking should trigger the service's Beeper Desktop focus action. */
  openInApp?: 'beeper'
  /** Notebook-relative path to the saved capture, if any. */
  savedPath?: string
}

export interface NeedsResponseScreenVerdict {
  needsResponse: number
  ownerAddressed: number
}

export interface NeedsResponseScreen {
  version: string
  assess: (input: {
    candidate: NeedsResponseCandidate
    ownerName: string
    today: string
  }) => Promise<NeedsResponseScreenVerdict | null>
}

export interface CachedGmailThread {
  historyId: string
  status: 'active' | 'replied' | 'ignored' | 'unregistered'
  checkedAt: string
  cacheVersion?: number
  candidate?: NeedsResponseCandidate
}

export interface CachedScreenReceipt {
  needsResponse: number
  ownerAddressed: number
  checkedAt: string
}

export interface DismissedEntry {
  version: string
  dismissedAt: string
}

export interface NeedsResponseStateFile {
  version: 1
  lastScanAt: string | null
  items: Record<string, StoredNeedsResponseEntry>
  dismissed: Record<string, DismissedEntry>
  screens: Record<string, CachedScreenReceipt>
  gmailThreads: Record<string, CachedGmailThread>
}

export interface NeedsResponseScanReport {
  scannedAt: string
  capturesFound: number
  gmailThreadsChecked: number
  screened: number
  active: number
  errors: string[]
}
