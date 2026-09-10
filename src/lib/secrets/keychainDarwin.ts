// Loaded only by the disposable helper. No Security.framework call runs in the server.
import { dlopen, ptr, toArrayBuffer } from 'bun:ffi'
import { closeSync, openSync } from 'node:fs'
import path from 'node:path'
import type { KeychainEntryRequest, KeychainReply } from './keychainProtocol.ts'
import { restoreKeychainSession } from './keychainRecovery.ts'

const security = dlopen('/System/Library/Frameworks/Security.framework/Security', {
  SecKeychainSetUserInteractionAllowed: { args: ['bool'], returns: 'i32' },
  SecKeychainCopyDefault: { args: ['ptr'], returns: 'i32' },
  SecKeychainGetStatus: { args: ['ptr', 'ptr'], returns: 'i32' },
  SecKeychainCopySettings: { args: ['ptr', 'ptr'], returns: 'i32' },
  SecKeychainLock: { args: ['ptr'], returns: 'i32' },
  SecKeychainUnlock: { args: ['ptr', 'u32', 'ptr', 'bool'], returns: 'i32' },
  SecKeychainFindGenericPassword: { args: ['ptr', 'u32', 'ptr', 'u32', 'ptr', 'ptr', 'ptr', 'ptr'], returns: 'i32' },
  SecKeychainAddGenericPassword: { args: ['ptr', 'u32', 'ptr', 'u32', 'ptr', 'u32', 'ptr', 'ptr'], returns: 'i32' },
  SecKeychainItemModifyAttributesAndData: { args: ['ptr', 'ptr', 'u32', 'ptr'], returns: 'i32' },
  SecKeychainItemDelete: { args: ['ptr'], returns: 'i32' },
  SecKeychainItemFreeContent: { args: ['ptr', 'ptr'], returns: 'i32' },
}).symbols
const core = dlopen('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation', {
  CFRelease: { args: ['ptr'], returns: 'void' },
}).symbols
const system = dlopen('/usr/lib/libSystem.B.dylib', {
  flock: { args: ['i32', 'i32'], returns: 'i32' },
  alarm: { args: ['u32'], returns: 'u32' },
  signal: { args: ['i32', 'ptr'], returns: 'ptr' },
}).symbols

/** Kernel deadline still fires if JS is blocked or the server that launched us dies. */
export function armKeychainDeadline(milliseconds: number): void {
  system.signal(14, null) // SIGALRM, default disposition: terminate this helper.
  system.alarm(Math.max(1, Math.ceil(milliseconds / 1000)))
}

/** The kernel releases this lock even if the helper is killed during authentication. */
export async function lockKeychain(stateDir: string): Promise<() => void> {
  const fd = openSync(path.join(stateDir, 'access.lock'), 'a', 0o600)
  while (system.flock(fd, 2 | 4) !== 0) await new Promise((resolve) => setTimeout(resolve, 50))
  return () => closeSync(fd)
}

export function darwinReply(status: number, value: string | null = null): KeychainReply {
  if (status === 0) return { ok: true, value }
  return { ok: false, kind: [-128, -25293, -25308, -25315].includes(status) ? 'access' : 'unavailable', status }
}

export function restoreDarwinKeychain(): KeychainReply {
  const allowed = security.SecKeychainSetUserInteractionAllowed(true)
  if (allowed !== 0) return darwinReply(allowed)
  const keychain = new BigUint64Array(1)
  const copied = security.SecKeychainCopyDefault(ptr(keychain))
  if (copied !== 0) return darwinReply(copied)
  try {
    return darwinReply(
      restoreKeychainSession({
        status: () => {
          const flags = new Uint32Array(1)
          const status = security.SecKeychainGetStatus(keychain[0], ptr(flags))
          return { status, unlocked: (flags[0] & 1) !== 0 }
        },
        check: () => {
          // SecKeychainSettings: UInt32 version, two Boolean fields, UInt32 interval.
          const settings = new Uint32Array([1, 0, 0])
          return security.SecKeychainCopySettings(keychain[0], ptr(settings))
        },
        lock: () => security.SecKeychainLock(keychain[0]),
        // macOS owns the password prompt; no password ever enters Sky.
        unlock: () => security.SecKeychainUnlock(keychain[0], 0, null, false),
      }),
    )
  } finally {
    if (keychain[0]) core.CFRelease(keychain[0])
  }
}

export function accessDarwinKeychain(request: KeychainEntryRequest): KeychainReply {
  const allowed = security.SecKeychainSetUserInteractionAllowed(request.interactive === true)
  if (allowed !== 0) return darwinReply(allowed)
  const service = Buffer.from(request.service)
  const account = Buffer.from(request.account)
  const length = new Uint32Array(1)
  const data = new BigUint64Array(1)
  const item = new BigUint64Array(1)
  const reading = request.operation === 'get'
  let status = security.SecKeychainFindGenericPassword(
    null,
    service.length,
    ptr(service),
    account.length,
    ptr(account),
    reading ? ptr(length) : null,
    reading ? ptr(data) : null,
    ptr(item),
  )
  try {
    if (reading) {
      if (status === -25300) return { ok: true, value: null }
      const value =
        status === 0 && length[0] > 0
          ? Buffer.from(toArrayBuffer(Number(data[0]), 0, length[0])).toString('utf8')
          : status === 0
            ? ''
            : null
      return darwinReply(status, value)
    }
    if (status !== 0 && status !== -25300) return darwinReply(status)
    if (request.operation === 'delete') {
      return status === -25300 ? { ok: true, value: null } : darwinReply(security.SecKeychainItemDelete(item[0]))
    }
    const value = Buffer.from(request.value ?? '')
    // Existing items keep their access controls. Never broaden a Keychain ACL.
    status =
      status === -25300
        ? security.SecKeychainAddGenericPassword(
            null,
            service.length,
            ptr(service),
            account.length,
            ptr(account),
            value.length,
            value.length ? ptr(value) : null,
            null,
          )
        : security.SecKeychainItemModifyAttributesAndData(item[0], null, value.length, value.length ? ptr(value) : null)
    return darwinReply(status)
  } finally {
    if (data[0]) security.SecKeychainItemFreeContent(null, data[0])
    if (item[0]) core.CFRelease(item[0])
  }
}
