import { runCommand } from '#lib/sys/mod.ts'

/** This Mac on the owner's tailnet: the name the owner's other devices reach it by, and the owner's login. */
export interface Tailnet {
  /** The Mac's name on the tailnet, such as `atlas-mac.tail-example.ts.net` */
  host: string
  /** The login of the person this Mac belongs to, as Tailscale reports it */
  login: string
}

/** The parts of `tailscale status --json` read here. */
export interface TailscaleStatus {
  BackendState?: string
  Self?: { DNSName?: string; UserID?: number }
  User?: Record<string, { LoginName?: string }>
}

/** The Tailscale command: on the PATH, else inside the Mac app. */
const COMMANDS = ['tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale']

/** How long a reading stands before Tailscale is asked again. */
const FRESH_MS = 60_000

/** This Mac's tailnet from Tailscale's status; null when Tailscale is signed out, stopped, or says too little. */
export function readTailnet(status: TailscaleStatus): Tailnet | null {
  if (status.BackendState !== 'Running') return null
  const host = status.Self?.DNSName?.replace(/\.$/, '').toLowerCase()
  const id = status.Self?.UserID
  const login = id === undefined ? undefined : status.User?.[String(id)]?.LoginName
  return host && login ? { host, login } : null
}

type Run = typeof runCommand

/**
 * Asks Tailscale who this Mac is at most once a minute. Missing, not running, or unreadable all read as
 * no tailnet, so nothing reaches Sky through it until Tailscale answers.
 */
export function tailnetIdentity(run: Run = runCommand, now = () => performance.now()): () => Promise<Tailnet | null> {
  let reading: { at: number; tailnet: Promise<Tailnet | null> } | null = null
  const ask = async (): Promise<Tailnet | null> => {
    for (const command of COMMANDS) {
      const result = await run(command, ['status', '--json'], { timeout: 5000 })
      if (!result.success) continue
      try {
        return readTailnet(JSON.parse(result.stdout) as TailscaleStatus)
      } catch {
        return null
      }
    }
    return null
  }
  return () => {
    if (!reading || now() - reading.at >= FRESH_MS) reading = { at: now(), tailnet: ask() }
    return reading.tailnet
  }
}
