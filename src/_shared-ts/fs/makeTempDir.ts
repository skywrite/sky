import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'

export interface MakeTempDirOptions {
  prefix?: string
}

export default async function makeTempDir(options?: MakeTempDirOptions): Promise<string> {
  const prefix = options?.prefix ?? 'tmp-'
  return mkdtemp(path.join(tmpdir(), prefix))
}
