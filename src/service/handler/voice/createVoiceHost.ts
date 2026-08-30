/**
 * The service's wiring of a voice thread: ai:voice's persona, opening
 * line, and ask_notebook delegate, built from an in-process
 * CommandService, plus the notebook tools a browser may run without being
 * asked — the same default-deny set the web chat offers. Minting the
 * client secret is the only thing here that touches OpenAI; the browser
 * does the talking.
 */

import OpenAI from 'openai'
import { discoverAIChatTools, runToolCommand } from '#commands/lib/chat/notebookTools.ts'
import CommandContext from '#commands/lib/core/CommandContext.ts'
import CommandService from '#commands/lib/core/CommandService.ts'
import { commandDescriptionToSchema } from '#commands/lib/jsonSchema.ts'
import { ASK_NOTEBOOK, ASK_NOTEBOOK_TOOL, askNotebook } from '#commands/lib/voice/notebookAgent.ts'
import {
  AUDITION_PASSAGE,
  auditionSessionConfig,
  DEFAULT_VOICE,
  DEFAULT_VOICE_MODEL,
  openingInstructions,
  renderVoicePrompts,
  type Voice,
  VOICE_GROUPS,
  VOICES,
  type VoiceClock,
  voiceSessionConfig,
} from '#commands/lib/voice/sessionConfig.ts'
import { getProfile, resolveProfile, ROLES } from '#shared/ai/models.ts'
import type * as ConfigModule from '#shared/config.ts'
import { renderTemplate } from '#shared/prompts/mod.ts'
import type { AuditionHost, ClientSecretMinter, VoiceRoutesOptions, VoiceThreadFactory, VoiceTool } from './mod.ts'

/** How long a minted secret can start a session; the session itself outlives it. */
const SECRET_TTL_SECONDS = 60

function clockOf(context: CommandContext): VoiceClock {
  return {
    notebookDate: context.notebookNow.date,
    notebookTime: context.notebookNow.time,
    notebookTimezone: context.notebookNow.timezone,
    systemDate: context.systemNow.date,
    systemTime: context.systemNow.time,
    systemTimezone: context.systemNow.timezone,
  }
}

export function createVoiceHost(config: typeof ConfigModule, env: Record<string, string>): VoiceRoutesOptions {
  const createThread: VoiceThreadFactory = async () => {
    const context = CommandContext.server(config, env)
    const tasks = new CommandService(context)
    const prompts = await renderVoicePrompts(clockOf(context))
    const delegate = resolveProfile(getProfile(ROLES.reasoning))

    const tools = new Map<string, VoiceTool>()
    tools.set(ASK_NOTEBOOK, {
      definition: ASK_NOTEBOOK_TOOL,
      run: async (input) => {
        const question = typeof input.question === 'string' ? input.question.trim() : ''
        if (!question) return 'ask_notebook needs a question.'
        return (await askNotebook(tasks, delegate, prompts.askPrompt, question)).answer
      },
    })
    // Only tools that never ask — the page has no approval surface yet.
    for (const entry of await discoverAIChatTools()) {
      if (entry.needsApproval) continue
      tools.set(entry.toolName, {
        definition: {
          type: 'function',
          name: entry.toolName,
          description: entry.description,
          parameters: commandDescriptionToSchema(entry.commandClass.description),
        },
        run: async (input) => JSON.stringify(await runToolCommand(tasks, entry, input)),
      })
    }

    return {
      session: voiceSessionConfig({
        model: DEFAULT_VOICE_MODEL,
        voice: DEFAULT_VOICE,
        instructions: prompts.instructions,
        tools: [...tools.values()].map((tool) => tool.definition),
      }),
      opening: openingInstructions(prompts.instructions, prompts.greeting),
      tools,
    }
  }

  const mint: ClientSecretMinter = async (session) => {
    const apiKey = env.OPENAI_API_KEY
    if (!apiKey) throw new Error('OPENAI_API_KEY is not set — the voice session needs it.')
    const secret = await new OpenAI({ apiKey }).realtime.clientSecrets.create({
      expires_after: { anchor: 'created_at', seconds: SECRET_TTL_SECONDS },
      session,
    })
    return { value: secret.value, expiresAt: secret.expires_at }
  }

  // The audition: the same persona, one voice at a time, nothing but the passage.
  const audition: AuditionHost = {
    describe: () =>
      Promise.resolve({
        passage: renderTemplate(AUDITION_PASSAGE).output,
        groups: VOICE_GROUPS,
        current: DEFAULT_VOICE,
        model: DEFAULT_VOICE_MODEL,
      }),
    prepare: async (voice, passage) => {
      if (!(VOICES as readonly string[]).includes(voice)) return null
      const prompts = await renderVoicePrompts(clockOf(CommandContext.server(config, env)))
      return {
        session: auditionSessionConfig(voice as Voice, prompts.instructions),
        opening: openingInstructions(prompts.instructions, passage),
      }
    },
  }

  return { createThread, mint, audition }
}
