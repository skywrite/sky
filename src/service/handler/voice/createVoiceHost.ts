/** Sky speaks through GPT-Live; Sol owns reasoning and the existing service tools. */
import OpenAI from 'openai'
import { renderDayCalendar } from '#commands/all/day/meeting/lib/meetingCheck.ts'
import CommandContext from '#commands/lib/core/CommandContext.ts'
import { loadVoiceInitialContext } from '#commands/lib/voice/initialContext.ts'
import {
  AUDITION_PASSAGE,
  auditionSessionConfig,
  DEFAULT_VOICE_MODEL,
  preferredVoice,
  renderVoicePrompts,
  type Voice,
  VOICE_GROUPS,
  VOICES,
  type VoiceClock,
  voiceSessionConfig,
} from '#commands/lib/voice/sessionConfig.ts'
import { openaiKey } from '#shared/ai/llm/openaiProvider.ts'
import type * as ConfigModule from '#shared/config.ts'
import { renderTemplate } from '#shared/prompts/mod.ts'
import { voiceChatTools } from './chatTools.ts'
import { liveBackend } from './liveBackend.ts'
import type { AuditionHost, LiveSessionConnector, VoiceRoutesOptions, VoiceThreadFactory } from './mod.ts'
import { APPROVAL_TOOLS } from './mod.ts'

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
  const createThread: VoiceThreadFactory = async (_id, signal = new AbortController().signal, chat) => {
    if (!chat) throw new Error('Start voice from a chat so its tools and results stay with the conversation.')
    const context = CommandContext.server(config, env).fork({ signal })
    const clock = clockOf(context)
    const [calendar, initial, notebookContext] = await Promise.all([
      renderDayCalendar(context.secrets, context.notebookNow.plainDateTime.plainDate, config.DIR_TIME, {
        date: clock.notebookDate,
        time: clock.notebookTime,
      }),
      voiceChatTools(chat, [], signal),
      loadVoiceInitialContext(config, clock),
    ])
    signal.throwIfAborted()
    const prompts = await renderVoicePrompts({ ...clock, calendar, notebookContext })
    const { tools } = initial
    const delegations = new Map<string, ReturnType<typeof voiceChatTools>>()
    const gated = [...tools.values()].some((tool) => tool.needsApproval)
    return {
      session: voiceSessionConfig({
        voice: preferredVoice(),
        instructions: prompts.instructions,
        backendInstructions: [initial.instructions, prompts.askPrompt].join('\n\n'),
        tools: [...tools.values()].map((tool) => tool.definition).concat(gated ? APPROVAL_TOOLS : []),
      }),
      greeting: prompts.greeting,
      tools,
      toolsFor: async (id, turns) => {
        let built = delegations.get(id)
        if (!built) {
          built = voiceChatTools(chat, turns, signal)
          delegations.set(id, built)
          if (delegations.size > 32) delegations.delete(delegations.keys().next().value!)
        }
        return (await built).tools
      },
    }
  }

  const connect: LiveSessionConnector = async (session, sdp, signal) => {
    const client = new OpenAI({ apiKey: await openaiKey(), timeout: 30_000, maxRetries: 0 })
    const answer = await client.live.create({ session, transport: { type: 'webrtc', sdp } }, { signal })
    return {
      sessionId: answer.session.id,
      sdp: answer.transport.sdp,
      ...(session.delegation?.type === 'responses' ? { backend: liveBackend(client, answer.session.id) } : {}),
    }
  }

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
      return {
        session: auditionSessionConfig(voice as Voice),
        opening: `The audio is ready. Immediately say this preview passage once, exactly, then remain silent: ${JSON.stringify(passage)}`,
      }
    },
  }
  return { createThread, connect, audition }
}
