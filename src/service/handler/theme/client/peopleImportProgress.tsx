import { Loader } from '@mantine/core'
import type { LinkedInImport, LinkedInImportPhase } from '#lib/linkedin/types.ts'
import { CredentialIcon } from './settingsCredentialIcons.tsx'

const headings: Record<LinkedInImportPhase, string> = {
  opening: 'Opening LinkedIn…',
  signing_in: 'Waiting for your approval',
  waiting: 'Finishing sign-in…',
  needs_user: 'Needs your attention',
  loading_profile: 'Loading profile…',
  reading: 'Reading profile…',
  preparing: 'Preparing your draft…',
}

export function PeopleImportProgress({ job }: { job?: LinkedInImport }) {
  // Jobs already running when Sky updates may have only the original status text.
  const phase =
    job?.phase ??
    (job?.stage.startsWith('Preparing')
      ? 'preparing'
      : job?.stage.startsWith('Reading')
        ? 'reading'
        : job?.stage.startsWith('The requested profile is open')
          ? 'loading_profile'
          : /sign.in|verification|approve/i.test(job?.stage ?? '')
            ? 'needs_user'
            : 'opening')
  const active = phase === 'preparing' ? 2 : phase === 'reading' || phase === 'loading_profile' ? 1 : 0
  const waiting = phase === 'signing_in' || phase === 'needs_user'
  const elapsed = job?.elapsedSeconds
  return (
    <section className="sky-people-import-progress" aria-label="LinkedIn import progress" data-waiting={waiting}>
      <div className="sky-people-import-activity">
        <span className="sky-people-import-indicator" aria-hidden="true">
          {waiting ? <CredentialIcon name="lock" size={26} /> : <Loader size={26} />}
        </span>
        <div role="status" aria-live="polite" className="sky-people-import-status">
          <strong>{headings[phase]}</strong>
          <p>{job?.stage ?? 'Starting a private browser for this import…'}</p>
        </div>
        {elapsed !== undefined && (
          <span className="sky-people-import-elapsed" aria-label={`${elapsed} seconds elapsed`}>
            {elapsed >= 60 ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s` : `${elapsed}s`}
          </span>
        )}
      </div>
      <ol className="sky-people-import-steps" aria-label="Import steps">
        {['Sign in', 'Read profile', 'Prepare draft'].map((label, index) => (
          <li
            key={label}
            data-state={index < active ? 'done' : index === active ? 'active' : 'waiting'}
            aria-current={index === active ? 'step' : undefined}
          >
            <span aria-hidden="true">{index < active ? <CredentialIcon name="check" size={14} /> : index + 1}</span>
            {label}
          </li>
        ))}
      </ol>
    </section>
  )
}
