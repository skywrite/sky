import * as path from 'node:path'
import type { AgentSlackFile } from './types.ts'

/**
 * agent-slack currently omits file IDs from JSON but names downloads F….ext
 * (including F….download-error.txt). Keep this compatibility rule at the CLI
 * boundary; arbitrary attachment paths elsewhere do not imply provider IDs.
 */
export function identifyAgentSlackFiles(files: AgentSlackFile[] | undefined): AgentSlackFile[] | undefined {
  return files?.map((file) => ({
    ...file,
    id: file.id ?? (file.path ? path.basename(file.path).match(/^(F[A-Z0-9]+)(?:\.[^.]+)*$/)?.[1] : undefined),
  }))
}
