/**
 * The one-time Google Cloud setup, one step per line. Sky's automated setup
 * (lib/google/cloudSetup) walks these in a browser; when a step cannot be
 * done for the person, its line is what they are shown. `sky google:auth
 * --manual` prints them and the settings page shows them beside the client
 * form, so the three never drift.
 */

/** The Cloud APIs behind GOOGLE_SCOPES — each has to be on in the project before the first call. */
export const GOOGLE_APIS: ReadonlyArray<{ service: string; name: string }> = [
  { service: 'gmail.googleapis.com', name: 'Gmail API' },
  { service: 'calendar-json.googleapis.com', name: 'Google Calendar API' },
  { service: 'drive.googleapis.com', name: 'Google Drive API' },
  { service: 'docs.googleapis.com', name: 'Google Docs API' },
  { service: 'sheets.googleapis.com', name: 'Google Sheets API' },
  { service: 'slides.googleapis.com', name: 'Google Slides API' },
]

export const GOOGLE_CONSOLE_URL = 'https://console.cloud.google.com'

/**
 * The name the person sees in Google's own pages — project, app and client
 * alike. The console wants a project name of 4 to 30 characters, so it is
 * not just "Sky".
 */
export const APP_NAME = 'Sky Notebook'

/**
 * Google will only publish an app that names a home page and a privacy
 * policy, on a domain it lists as authorized. Sky's are its public repo.
 */
export const APP_HOMEPAGE_URL = 'https://github.com/skywrite/sky'
export const APP_PRIVACY_URL = 'https://github.com/skywrite/sky/blob/main/PRIVACY.md'
export const APP_DOMAIN = 'github.com'

/** The console page that switches on every API at once; `project=` picks the project. */
export function enableApisUrl(projectId?: string): string {
  const url = new URL(`${GOOGLE_CONSOLE_URL}/flows/enableapi`)
  url.searchParams.set('apiid', GOOGLE_APIS.map((api) => api.service).join(','))
  if (projectId) url.searchParams.set('project', projectId)
  return url.toString()
}

/** The console steps in order; the key is what the automated setup reports. */
export type SetupStepKey = 'project' | 'apis' | 'branding' | 'publish' | 'client'

export interface SetupStep {
  key: SetupStepKey
  /** What the person sees ticking off, in plain words */
  label: string
  /** How to do it by hand, when Sky cannot */
  instruction: string
}

export const GOOGLE_CLOUD_SETUP: readonly SetupStep[] = [
  {
    key: 'project',
    label: 'Creating your private connection',
    instruction: `At ${GOOGLE_CONSOLE_URL}/projectcreate create a project named "${APP_NAME}".`,
  },
  {
    key: 'apis',
    label: 'Turning on Mail, Calendar, Drive and Docs',
    instruction: `Switch on the APIs Sky uses (${GOOGLE_APIS.map((api) => api.name).join(', ')}): ${enableApisUrl()}`,
  },
  {
    key: 'branding',
    label: `Naming it "${APP_NAME}"`,
    instruction: `Google Auth Platform > Get started — app name "${APP_NAME}", your email as the support email, audience External, your email as the contact; agree to the User Data Policy and create. Add no scopes.`,
  },
  {
    key: 'publish',
    label: 'Making it permanent',
    instruction: 'Google Auth Platform > Audience — Publish app (in Testing, every grant expires after 7 days).',
  },
  {
    key: 'client',
    label: 'Saving the key on this Mac',
    instruction: `Google Auth Platform > Clients > Create client — type "Desktop app", name "${APP_NAME}". Google shows the secret only in the dialog that follows: copy both, or leave it open for Sky to read.`,
  },
]

/** The steps as lines, for the terminal walkthrough and the client form. */
export const GOOGLE_CLOUD_SETUP_STEPS: readonly string[] = GOOGLE_CLOUD_SETUP.map((step) => step.instruction)

/** Shown once per account: Google warns about an unverified app; for your own client that is expected. */
export const GOOGLE_UNVERIFIED_APP_NOTE =
  'Authorizing an account shows Google\'s "unverified app" warning once — Advanced > Continue is expected for your own client.'
