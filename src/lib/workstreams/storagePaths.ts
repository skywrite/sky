import { createHash } from 'node:crypto'
import * as path from 'node:path'

export type WorkstreamStorageConfig = { DIR_BASE: string; DIR_STATE: string }

export function workstreamStoragePaths(config: WorkstreamStorageConfig) {
  const namespace = createHash('sha256').update(config.DIR_BASE).digest('hex').slice(0, 16)
  const stateDir = path.join(config.DIR_STATE, 'workstreams', namespace)
  const contentRoot = path.join(stateDir, 'content')
  return {
    stateDir,
    contentRoot,
    dir: path.join(contentRoot, 'workstreams'),
    automationsDir: path.join(stateDir, 'automations'),
    legacyDir: path.join(config.DIR_BASE, 'workstreams'),
  }
}
