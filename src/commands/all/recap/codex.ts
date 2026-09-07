import * as path from 'node:path'
import { Command, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, CommandResult, InferParams } from '#commands/mod.ts'
import { DIR_HOME } from '#config'
import { env } from '#shared/sys/mod.ts'
import scanCodexSessions from './lib/codex.ts'
import {
  codingRecapDescription,
  codingRecapParams,
  recapCodingSessions,
  type CodingRecapResult,
} from './lib/recapCodingSessions.ts'

const params = {
  ...codingRecapParams,
  codexDir: Flag.string('Codex home directory containing sessions/ and archived_sessions/', {
    default: () => env.get('CODEX_HOME') || path.join(DIR_HOME, '.codex'),
  }),
}

type Params = InferParams<typeof params>

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'recap:codex': { params: Params; result: CodingRecapResult }
  }
}

export default class RecapCodexTask extends Command {
  static override description: CommandDescription = {
    ...codingRecapDescription('codex', 'Codex'),
    params,
  }

  async run(command: CommandArgs<Params>): Promise<CommandResult<CodingRecapResult>> {
    return recapCodingSessions(command, {
      app: 'codex',
      label: 'Codex',
      scan: (window) => scanCodexSessions(command.args.codexDir, window),
    })
  }
}
