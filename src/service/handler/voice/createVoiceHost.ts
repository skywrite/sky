/**
 * Browser voice wiring: shared persona and starting context, quick Qwen
 * lookup, background Astra research, and live command tools. Sky hosts
 * the conversation; Sonny joins it and presents research through his own
 * speech session. Audio travels directly between the browser and OpenAI.
 */

import OpenAI from 'openai'
import { renderDayCalendar } from '#commands/all/day/meeting/lib/meetingCheck.ts'
import { discoverAIChatTools } from '#commands/lib/chat/notebookTools.ts'
import CommandContext from '#commands/lib/core/CommandContext.ts'
import CommandService from '#commands/lib/core/CommandService.ts'
import { createVoiceEmailTools } from '#commands/lib/voice/emailTools.ts'
import { loadVoiceInitialContext } from '#commands/lib/voice/initialContext.ts'
import {
  createVoiceResearch,
  LOOKUP_NOTEBOOK,
  LOOKUP_NOTEBOOK_TOOL,
  LOOKUP_WEB,
  LOOKUP_WEB_TOOL,
  RESEARCH_NOTEBOOK,
  RESEARCH_NOTEBOOK_TOOL,
  RESEARCH_TOGETHER_TOOL,
  RESEARCH_WEB,
  RESEARCH_WEB_TOOL,
  RESUME_RESEARCH_TOOL,
} from '#commands/lib/voice/research.ts'
import {
  AUDITION_PASSAGE,
  auditionSessionConfig,
  BROWSER_VOICE_EFFORT,
  DEFAULT_VOICE_MODEL,
  DEFAULT_RESEARCHER_NAME,
  INVITE_SONNY_TOOL,
  preferredVoice,
  preferredResearcherVoice,
  openingInstructions,
  renderVoicePrompts,
  researcherSessionConfig,
  type Voice,
  VOICE_GROUPS,
  VOICES,
  type VoiceClock,
  voiceSessionConfig,
} from '#commands/lib/voice/sessionConfig.ts'
import type * as ConfigModule from '#shared/config.ts'
import { renderTemplate } from '#shared/prompts/mod.ts'
import { createVoiceCommandTools } from './commandTools.ts'
import type { AuditionHost, ClientSecretMinter, VoiceRoutesOptions, VoiceThreadFactory, VoiceTool } from './mod.ts'
import { APPROVAL_TOOLS } from './mod.ts'

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
    const clock = clockOf(context)
    // Prepare the notebook snapshot alongside calendar and tool discovery.
    const [calendar, entries, notebookContext] = await Promise.all([
      renderDayCalendar(context.secrets, context.notebookNow.plainDateTime.plainDate, config.DIR_TIME, {
        date: clock.notebookDate,
        time: clock.notebookTime,
      }),
      discoverAIChatTools(),
      loadVoiceInitialContext(config, clock),
    ])
    const prompts = await renderVoicePrompts({ ...clock, calendar, notebookContext, dualVoice: true })
    const research = createVoiceResearch({ config, systemPrompt: prompts.askPrompt, webApiKey: env.PERPLEXITY_API_KEY })

    const tools = new Map<string, VoiceTool>(createVoiceEmailTools({ secrets: context.secrets }))
    for (const [name, definition, run] of [
      [LOOKUP_NOTEBOOK, LOOKUP_NOTEBOOK_TOOL, research.lookup],
      [RESEARCH_NOTEBOOK, RESEARCH_NOTEBOOK_TOOL, research.research],
      [LOOKUP_WEB, LOOKUP_WEB_TOOL, research.lookupWeb],
      [RESEARCH_WEB, RESEARCH_WEB_TOOL, research.researchWeb],
    ] as const) {
      tools.set(name, {
        definition,
        run: async (input, signal) => {
          const question = typeof input.question === 'string' ? input.question.trim() : ''
          if (!question)
            return JSON.stringify({ status: 'failed', answer: 'The research question is missing.', paths: [] })
          const result =
            name === RESEARCH_NOTEBOOK
              ? await research.research(question, signal, input.notebook_only === true)
              : await run(question, signal)
          // Preserve the outcome and evidence together; a partial answer is not a failed lookup.
          return JSON.stringify(result)
        },
      })
    }
    for (const [name, tool] of createVoiceCommandTools(entries, tasks)) tools.set(name, tool)

    // The gate's confirm/cancel ride along whenever something can park.
    const gated = [...tools.values()].some((tool) => tool.needsApproval)
    return {
      session: voiceSessionConfig({
        model: DEFAULT_VOICE_MODEL,
        effort: BROWSER_VOICE_EFFORT,
        voice: preferredVoice(),
        instructions: prompts.instructions,
        tools: [...tools.values()]
          .map((tool) => tool.definition)
          .concat(INVITE_SONNY_TOOL, RESUME_RESEARCH_TOOL, RESEARCH_TOGETHER_TOOL, gated ? APPROVAL_TOOLS : []),
        manualTurns: true,
      }),
      researcher: {
        name: DEFAULT_RESEARCHER_NAME,
        session: researcherSessionConfig({
          voice: preferredResearcherVoice(),
          instructions: prompts.researcherInstructions,
        }),
      },
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
        current: preferredVoice(),
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
