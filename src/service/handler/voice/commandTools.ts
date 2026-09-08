import type { FormatApprovalFn, NeedsApprovalForFn } from '#commands/lib/AIChatTool.ts'
import { type DiscoveredTool, runToolCommand } from '#commands/lib/chat/notebookTools.ts'
import CommandService from '#commands/lib/core/CommandService.ts'
import { commandDescriptionToSchema } from '#commands/lib/jsonSchema.ts'
import { approvalCard } from '../chat/approvalCard.ts'
import type { VoiceTool } from './mod.ts'

/** Voice offers a deliberate subset of the decorated chat commands. */
const VOICE_COMMANDS = new Set([
  'day:items',
  'day:items:add',
  'day:items:done',
  'slack:unread',
  'slack:api:channels',
  'slack:draft:new',
  'slack:draft:reply',
  'slack:draft:update',
  'google:email:inbox:view',
  'google:email:read',
  'google:email:draft:new',
  'google:email:draft:reply',
  'google:email:draft:update',
  'calendar:schedule',
  'calendar:update',
])

export function createVoiceCommandTools(entries: DiscoveredTool[], tasks: CommandService): Map<string, VoiceTool> {
  return new Map(
    entries
      .filter((entry) => VOICE_COMMANDS.has(entry.commandName))
      .map((entry) => {
        const formatter = entry.commandClass.formatApproval as FormatApprovalFn | undefined
        return [
          entry.toolName,
          {
            definition: {
              type: 'function',
              name: entry.toolName,
              description: entry.description,
              parameters: commandDescriptionToSchema(entry.commandClass.description),
            },
            run: async (input, signal) =>
              JSON.stringify(await runToolCommand(new CommandService(tasks.context.fork({ signal })), entry, input)),
            needsApproval: entry.needsApproval,
            needsApprovalFor: entry.commandClass.needsApprovalFor as NeedsApprovalForFn | undefined,
            approvalSummary: formatter
              ? async (input, signal) =>
                  (await approvalCard(entry.toolName, input, formatter, tasks.context.fork({ signal }))).join('\n')
              : undefined,
          },
        ]
      }),
  )
}
