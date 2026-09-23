import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import type { SetupStepKey } from '../setup.ts'

// A run that stops halfway — a closed window, a step Sky could not find,
// a crash — picks up where it stopped: the browser profile keeps the
// sign-in, and this file keeps what the console already has. Both go away
// when a run finishes. No secret lives here: the client pair goes straight
// to the keychain the moment Google shows it.

/** The setup's own browser profile — never the automation profile the workspace agent signs in to. */
export const SETUP_PROFILE_DIR = path.join(os.homedir(), '.sky', 'google-setup-profile')

export const SETUP_RESUME_FILE = path.join(os.homedir(), '.sky', 'google-setup.json')

/**
 * Every project Sky ever chose an id for, kept for good: the one record that
 * says a project is Sky's own. A finished run's tidy-up shuts down the ones
 * no account uses, and only those — a project named by hand is never touched.
 */
export const SETUP_LEDGER_FILE = path.join(os.homedir(), '.sky', 'google-setup-projects.json')

export interface SetupLedger {
  v: 1
  projects: { id: string; at: string }[]
}

export async function readLedger(file: string = SETUP_LEDGER_FILE): Promise<SetupLedger> {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as Partial<SetupLedger>
    if (parsed.v !== 1 || !Array.isArray(parsed.projects)) return { v: 1, projects: [] }
    return {
      v: 1,
      projects: parsed.projects.filter(
        (p): p is { id: string; at: string } => typeof p?.id === 'string' && typeof p?.at === 'string',
      ),
    }
  } catch {
    return { v: 1, projects: [] }
  }
}

export async function writeLedger(ledger: SetupLedger, file: string = SETUP_LEDGER_FILE): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8')
}

/** Note a project as Sky's the moment its id is chosen. */
export async function rememberProject(projectId: string, file: string = SETUP_LEDGER_FILE): Promise<void> {
  const ledger = await readLedger(file)
  if (ledger.projects.some((p) => p.id === projectId)) return
  ledger.projects.push({ id: projectId, at: new Date().toISOString() })
  await writeLedger(ledger, file)
}

export async function forgetProjects(projectIds: string[], file: string = SETUP_LEDGER_FILE): Promise<void> {
  const ledger = await readLedger(file)
  ledger.projects = ledger.projects.filter((p) => !projectIds.includes(p.id))
  await writeLedger(ledger, file)
}

export interface SetupResume {
  v: 1
  startedAt: string
  projectId?: string
  /** The account, as the console showed it — learned while naming the app */
  email?: string
  done: SetupStepKey[]
}

export function emptyResume(now: Date = new Date()): SetupResume {
  return { v: 1, startedAt: now.toISOString(), done: [] }
}

export async function readResume(file: string = SETUP_RESUME_FILE): Promise<SetupResume | null> {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as Partial<SetupResume>
    if (parsed.v !== 1 || !Array.isArray(parsed.done)) return null
    return {
      v: 1,
      startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : new Date().toISOString(),
      ...(typeof parsed.projectId === 'string' ? { projectId: parsed.projectId } : {}),
      ...(typeof parsed.email === 'string' ? { email: parsed.email } : {}),
      done: parsed.done.filter((key): key is SetupStepKey => typeof key === 'string'),
    }
  } catch {
    return null
  }
}

export async function writeResume(resume: SetupResume, file: string = SETUP_RESUME_FILE): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(resume, null, 2)}\n`, 'utf8')
}

/** A finished run leaves nothing behind: the note and the signed-in profile both go. */
export async function clearSetupLeftovers(options: { file?: string; profileDir?: string } = {}): Promise<void> {
  await rm(options.file ?? SETUP_RESUME_FILE, { force: true }).catch(() => undefined)
  await rm(options.profileDir ?? SETUP_PROFILE_DIR, { recursive: true, force: true }).catch(() => undefined)
}
