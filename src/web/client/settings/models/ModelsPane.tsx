import { Button, Modal } from '@mantine/core'
import { useEffect, useRef, useState, type MouseEvent } from 'react'
import type { ProfileRow, SettingsData } from '../settings.tsx'
import { AssignmentDialog } from './AssignmentDialog.tsx'
import { Assignments } from './Assignments.tsx'
import { DecisionDialog } from './DecisionDialog.tsx'
import { ModelIcon } from './ModelIcon.tsx'
import { PresetLibrary } from './PresetLibrary.tsx'
import { presetTitle } from './presets.ts'
import { assignmentsHref, libraryHref, modelsRoute } from './routes.ts'
import './ModelsPane.css'

export function ModelsPane({
  data,
  path,
  navigate,
  reload,
  loadError,
}: {
  data: SettingsData | null
  path: string
  navigate: (to: string, replace?: boolean) => void
  reload: () => Promise<void>
  loadError: boolean
}) {
  const { library, detail } = modelsRoute(path)
  // The service returns user overrides before their built-in originals.
  const profiles = new Map<string, ProfileRow>()
  for (const p of data?.profiles ?? []) {
    if (!profiles.has(p.name)) profiles.set(p.name, p)
  }
  const preset = detail?.kind === 'preset' ? profiles.get(detail.name) : undefined
  const role = detail?.kind === 'role' ? data?.models.find((r) => r.role === detail.name) : undefined
  let title = library ? 'Preset library' : 'Models'
  if (detail?.kind === 'decisions') title = 'Background decisions'
  if (detail?.kind === 'new') title = 'New language preset'
  if (detail?.kind === 'preset') title = preset ? presetTitle(preset) : detail.name || 'Preset'
  if (detail?.kind === 'role')
    title = detail.name === 'chat' ? 'New chat preset' : `${role?.label ?? detail.name} preset`
  useEffect(() => {
    document.title = `sky · ${title}`
  }, [title])
  useEffect(() => {
    // Key setup opens Connections in another tab. Read its result when this tab regains focus.
    const refresh = () => {
      void reload()
    }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [reload])
  const openedFromList = useRef<string | null>(null)
  const [notice, setNotice] = useState('')
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), 4200)
    return () => clearTimeout(timer)
  }, [notice])
  const follow = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return
    const a = (event.target as Element).closest<HTMLAnchorElement>('a[href]')
    if (!a || a.target || a.origin !== location.origin || !a.pathname.startsWith(assignmentsHref)) return
    event.preventDefault()
    if (a.pathname === path) return
    openedFromList.current = modelsRoute(a.pathname).detail ? a.pathname : null
    navigate(a.pathname)
  }
  const close = () => {
    if (openedFromList.current === path) window.history.back()
    else navigate(library ? libraryHref : assignmentsHref, true)
  }
  const saved = async (message: string) => {
    await reload()
    if (location.pathname === path) {
      close()
      setNotice(message)
    }
  }
  return (
    <div className="sky-models" onClick={follow}>
      <nav className="sky-model-views" aria-label="Model settings views">
        <a href={assignmentsHref} aria-current={!library ? 'page' : undefined}>
          <ModelIcon name="assignments" />
          Assignments
        </a>
        <a href={libraryHref} aria-current={library ? 'page' : undefined}>
          <ModelIcon name="layers" />
          Preset library
        </a>
      </nav>
      {loadError && (
        <Button size="sm" onClick={() => void reload()}>
          Reload model settings
        </Button>
      )}
      {!data ? (
        !loadError && <p role="status">Loading model settings…</p>
      ) : (
        <>
          {library ? (
            <PresetLibrary
              data={data}
              profiles={profiles}
              editing={detail?.kind === 'new' ? 'new' : preset}
              onClose={close}
              onSaved={saved}
            />
          ) : (
            <Assignments data={data} profiles={profiles} />
          )}
          {detail?.kind === 'decisions' && (
            <DecisionDialog decisions={data.decisions} onClose={close} reload={reload} />
          )}
          {role && <AssignmentDialog key={role.role} role={role} profiles={profiles} onClose={close} onSaved={saved} />}
          {((detail?.kind === 'preset' && !preset) || (detail?.kind === 'role' && !role)) && (
            <Modal opened centered title={`${detail.kind === 'role' ? 'Role' : 'Preset'} unavailable`} onClose={close}>
              <p className="sky-model-intro">“{detail.name}” is no longer available in these model settings.</p>
              <div className="sky-dialog-actions">
                <Button size="sm" onClick={close}>
                  Back to {library ? 'preset library' : 'assignments'}
                </Button>
              </div>
            </Modal>
          )}
        </>
      )}
      <div role="status" className="sky-model-notice">
        {notice}
      </div>
    </div>
  )
}
