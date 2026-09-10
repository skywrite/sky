interface KeychainSession {
  status: () => { status: number; unlocked: boolean }
  check: () => number
  lock: () => number
  unlock: () => number
}

/** Only explicit recovery may unlock the keychain or clear a stale macOS session. */
export function restoreKeychainSession(session: KeychainSession): number {
  const current = session.status()
  if (current.status !== 0) return current.status
  if (current.unlocked) {
    const checked = session.check()
    // macOS can report unlocked while even SecKeychainCopySettings fails with
    // errSecAuthFailed. An unlock alone then does nothing; see docs/README.md.
    if (checked !== -25293) return checked
    const locked = session.lock()
    if (locked !== 0) return locked
  }
  const unlocked = session.unlock()
  return unlocked === 0 ? session.check() : unlocked
}
