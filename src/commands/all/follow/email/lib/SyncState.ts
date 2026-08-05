import * as path from 'node:path'
import slugify from '#lib/string/slugify.ts'
import { exists, readTextFile } from '#shared/fs/mod.ts'
import { outputFile } from '#shared/fs/mod.ts'
import { parse, stringify } from '#shared/yaml/mod.ts'

export type SyncStateData = {
  account: string
  label: string
  lastUid: number
}

const STATE_DIR_NAME = 'state'

function stateFileName(account: string, label: string): string {
  const accountSlug = slugify(account, { preserveCase: true })
  const labelSlug = slugify(label, { preserveCase: true })
  return `email_${accountSlug}_${labelSlug}.yaml`
}

export async function readSyncState(followDir: string, account: string, label: string): Promise<SyncStateData | null> {
  const filePath = path.join(followDir, STATE_DIR_NAME, stateFileName(account, label))
  if (!(await exists(filePath))) return null

  const contents = await readTextFile(filePath)
  const data = parse(contents) as Record<string, unknown>
  return {
    account: data['account'] as string,
    label: data['label'] as string,
    lastUid: data['lastUid'] as number,
  }
}

export async function writeSyncState(followDir: string, state: SyncStateData): Promise<void> {
  const filePath = path.join(followDir, STATE_DIR_NAME, stateFileName(state.account, state.label))
  await outputFile(filePath, stringify(state))
}
