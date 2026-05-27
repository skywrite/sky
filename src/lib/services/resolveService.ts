import * as path from 'node:path'
import * as config from '#config'
import type { Service } from './types.ts'

/*
  Example:

  shortLabel: watch-desktop
  label: local.watch-desktop
  plistFilePath: ~/Library/LaunchAgents/local.watch-desktop.plist

*/

export default function resolveService(dirtyService: string): Service {
  if (!(typeof dirtyService === 'string')) throw new Error("resolveService() can't accept undefined.")
  if (dirtyService.length === 0) throw new Error("resolveService() can't accept an empty string")

  if (dirtyService.endsWith('.plist')) {
    const { shortLabel, label } = resolveFromPlistFilePath(dirtyService)
    return { shortLabel, label, plistFilePath: dirtyService }
  } else if (dirtyService.startsWith('local.')) {
    const { shortLabel, plistFilePath } = resolveFromLabel(dirtyService)
    return { shortLabel, label: dirtyService, plistFilePath }
  } else {
    // assumed short-hand
    const { label, plistFilePath } = resolveFormShortLabel(dirtyService)
    return { shortLabel: dirtyService, label, plistFilePath }
  }
}

function resolveFromPlistFilePath(plistFilePath: string): { shortLabel: string; label: string } {
  const label = plistFilePathToLabel(plistFilePath)
  const shortLabel = labelToShortLabel(label)
  return { shortLabel, label }
}

function resolveFromLabel(label: string): { shortLabel: string; plistFilePath: string } {
  const shortLabel = labelToShortLabel(label)
  const plistFilePath = labelToPlistFilePath(label)
  return { shortLabel, plistFilePath }
}

function resolveFormShortLabel(shortLabel: string): { label: string; plistFilePath: string } {
  const label = shortLabelToLabel(shortLabel)
  const plistFilePath = labelToPlistFilePath(label)
  return { label, plistFilePath }
}

function labelToShortLabel(label: string): string {
  return label.replace('local.', '') // all local notebook services start with "local."
}

function plistFilePathToLabel(plistFilePath: string): string {
  return path.basename(plistFilePath, '.plist')
}

function labelToPlistFilePath(label: string): string {
  return path.join(config.DIR_USER_SERVICES, label + '.plist')
}

function shortLabelToLabel(shortLabel: string): string {
  return 'local.' + shortLabel
}
