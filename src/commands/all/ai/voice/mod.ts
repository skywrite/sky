/**
 * ai:voice — talk to the notebook.
 *
 * A realtime speech session (OpenAI Realtime API over a server WebSocket,
 * PCM audio through the echo-cancelling helper or ffmpeg) fronting the
 * notebook. The session itself stays lean — a voice persona and one tool
 * — because realtime models re-bill the growing conversation on every
 * response; the heavy lifting happens behind ask_notebook, where the
 * reasoning model reads documents selected by ai:context:files. The voice
 * model narrates while that runs, so the notebook's search latency never
 * freezes the conversation.
 *
 * What the session IS — persona, opening line, delegate, configuration —
 * lives in commands/lib/voice, shared with the web page that holds the
 * same conversation over WebRTC. This command is the terminal transport.
 */

import process from 'node:process'
import colors from 'picocolors'
import { renderDayCalendar } from '#commands/all/day/meeting/lib/meetingCheck.ts'
import { ASK_NOTEBOOK, ASK_NOTEBOOK_TOOL, askNotebook } from '#commands/lib/voice/notebookAgent.ts'
import {
  DEFAULT_VOICE_MODEL,
  preferredVoice,
  REALTIME_EFFORTS,
  type RealtimeEffort,
  renderVoicePrompts,
  VOICES,
} from '#commands/lib/voice/sessionConfig.ts'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { getProfile, resolveProfile, ROLES } from '#shared/ai/models.ts'
import truncate from '#shared/strings/truncate.ts'
import { env } from '#shared/sys/mod.ts'
import { DuplexAudio, ensureAudioHelper, FfmpegAudio } from './lib/audio.ts'
import { VoiceSession } from './lib/session.ts'

const params = {
  model: Flag.string('Realtime voice model (gpt-realtime-2.1, or gpt-realtime-2.1-mini for cheaper sessions)', {
    default: () => DEFAULT_VOICE_MODEL,
  }),
  voice: Flag.string(`Voice for spoken replies: ${VOICES.join(', ')}`, { default: () => preferredVoice() }),
  reasoning: Flag.string('Model profile for the ask_notebook delegate (e.g. default-opus-5)', {
    short: 'r',
    default: () => ROLES.reasoning,
  }),
  effort: Flag.string('Realtime reasoning effort: minimal|low|medium|high|xhigh (default: server-chosen)', {
    optional: true,
  }),
  mic: Flag.string(
    'auto = echo-cancelled duplex engine; or an avfoundation device index/name for raw ffmpeg capture (mic mutes while Sky speaks)',
    { default: () => 'auto' },
  ),
}

type Params = InferParams<typeof params>

type Result = { turns: number }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'ai:voice': { params: Params; result: Result }
  }
}

export default class AiVoiceTask extends Command {
  static override description: CommandDescription = {
    name: 'ai:voice',
    description: 'Talk to the notebook by voice — a live speech session with an ask_notebook research delegate.',
    params,
  }

  async run({ args, context, tasks }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context

    const apiKey = env.get('OPENAI_API_KEY')
    if (!apiKey) {
      return CommandResult.fail('OPENAI_API_KEY is not set — the realtime session needs it.')
    }
    if (args.effort && !(REALTIME_EFFORTS as readonly string[]).includes(args.effort)) {
      return CommandResult.fail(`Unknown --effort "${args.effort}". Valid: ${REALTIME_EFFORTS.join(', ')}.`)
    }

    let delegateModel
    try {
      delegateModel = resolveProfile(getProfile(args.reasoning))
    } catch (err) {
      return CommandResult.fail((err as Error).message)
    }

    // Both prompts carry the session-start clocks; the persona also holds
    // today's calendar checked against the notebook. The greeting's name
    // slot fills from the AboutMe profile and folds away without one.
    const { notebookNow, systemNow } = context
    const calendar = await renderDayCalendar(
      context.secrets,
      notebookNow.plainDateTime.plainDate,
      <string>context.config.DIR_TIME,
      { date: notebookNow.date, time: notebookNow.time },
    )
    const prompts = await renderVoicePrompts({
      notebookDate: notebookNow.date,
      notebookTime: notebookNow.time,
      notebookTimezone: notebookNow.timezone,
      systemDate: systemNow.date,
      systemTime: systemNow.time,
      systemTimezone: systemNow.timezone,
      calendar,
    })

    output.log(colors.bold('Voice session'))
    output.log(colors.dim(`  ${args.model} · voice ${args.voice} · delegate ${args.reasoning}`))
    output.log(colors.dim(`  Tool: ${ASK_NOTEBOOK} · Ctrl+C to end`))

    // Pick the audio engine: the echo-cancelled Swift helper when available,
    // raw ffmpeg otherwise (or when a specific device was requested).
    const helperBinary = args.mic === 'auto' ? await ensureAudioHelper((line) => output.log(colors.dim(line))) : null
    const micDevice = args.mic === 'auto' ? '0' : args.mic
    output.log(
      colors.dim(
        helperBinary
          ? '  Audio: echo-cancelled duplex engine'
          : '  Audio: raw ffmpeg — mic mutes while Sky speaks; headphones give full duplex',
      ),
    )

    const startedAt = performance.now()
    let closeSession: () => void = () => {}
    const closed = new Promise<void>((resolve) => {
      closeSession = resolve
    })

    const session = new VoiceSession({
      apiKey,
      model: args.model,
      voice: args.voice,
      instructions: prompts.instructions,
      greeting: prompts.greeting,
      effort: args.effort as RealtimeEffort | undefined,
      createEngine: (callbacks) =>
        helperBinary ? new DuplexAudio(helperBinary, callbacks) : new FfmpegAudio(micDevice, callbacks),
      tools: [ASK_NOTEBOOK_TOOL],
      executeTool: async (name, input) => {
        if (name !== ASK_NOTEBOOK) return `Unknown tool: ${name}`
        const question = typeof input.question === 'string' ? input.question.trim() : ''
        if (!question) return `${ASK_NOTEBOOK} needs a question.`
        output.log(colors.dim(`${ASK_NOTEBOOK}: "${truncate(question, 100)}"`))
        const t0 = performance.now()
        const result = await askNotebook(tasks, delegateModel, prompts.askPrompt, question)
        output.log(colors.dim(`  ${result.paths.length} docs · ${((performance.now() - t0) / 1000).toFixed(1)}s`))
        return result.answer
      },
      out: {
        user: (t) => output.log(colors.bold('You: ') + t),
        assistant: (t) => output.log(colors.bold('Sky: ') + t),
        status: (line) => output.log(colors.dim(line)),
        warn: (line) => output.log(colors.yellow(`⚠ ${line}`)),
      },
      onClose: () => {
        output.log(colors.dim('Connection closed.'))
        closeSession()
      },
    })

    const onSigint = () => closeSession()
    process.on('SIGINT', onSigint)
    await closed
    process.off('SIGINT', onSigint)

    const { everConnected, assistantTurns } = session
    session.stop()

    if (!everConnected) {
      return CommandResult.fail('Realtime session never connected — check OPENAI_API_KEY, network, and model name.')
    }

    const minutes = (performance.now() - startedAt) / 60_000
    output.log('')
    output.log(
      colors.dim(
        `Session over — ${assistantTurns} spoken repl${assistantTurns === 1 ? 'y' : 'ies'}, ${minutes.toFixed(1)} min.`,
      ),
    )
    return CommandResult.success({ turns: assistantTurns })
  }
}
