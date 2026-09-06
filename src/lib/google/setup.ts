/**
 * The one-time Google Cloud setup, one step per line. `sky google:auth --setup`
 * prints these and the settings page shows them beside the client form, so
 * the two never drift.
 */
export const GOOGLE_CLOUD_SETUP_STEPS: readonly string[] = [
  'At https://console.cloud.google.com create a project (e.g. "sky").',
  'APIs & Services > Library — enable four APIs: Google Drive API, Google Docs API, Google Sheets API, Google Slides API.',
  'APIs & Services > OAuth consent screen — External, app name "sky", your email. Save. Skip every optional field; add no scopes here.',
  'Publish the app to Production (testing status expires refresh tokens after 7 days).',
  'Credentials > Create credentials > OAuth client ID — type "Desktop app".',
]

/** Shown once per account: Google warns about an unverified app; for your own client that is expected. */
export const GOOGLE_UNVERIFIED_APP_NOTE =
  'Authorizing an account shows Google\'s "unverified app" warning once — Advanced > Continue is expected for your own client.'
