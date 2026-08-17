/**
 * ai:voice — talk to the notebook.
 *
 * A realtime speech session (OpenAI Realtime API over a server WebSocket,
 * PCM audio through ffmpeg) fronting the notebook. The session itself
 * stays lean — a voice persona and one tool — because realtime models
 * re-bill the growing conversation on every response; the heavy lifting
 * happens behind ask_notebook, where the reasoning model reads documents
 * selected by ai:context:files. The voice model narrates while that runs,
 * so the notebook's search latency never freezes the conversation.
 */

import process from 'node:process'
import colors from 'picocolors'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { getProfile, resolveProfile, ROLES } from '#shared/ai/models.ts'
import { readTextFile } from '#shared/fs/mod.ts'
import { type RenderInput, renderPromptFile, renderTemplate } from '#shared/prompts/mod.ts'
import truncate from '#shared/strings/truncate.ts'
import { env } from '#shared/sys/mod.ts'
import { DuplexAudio, ensureAudioHelper, FfmpegAudio } from './lib/audio.ts'
import { ASK_NOTEBOOK_TOOL, askNotebook } from './lib/notebookAgent.ts'
import { VoiceSession } from './lib/session.ts'

const REALTIME_EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh'] as const
type RealtimeEffort = (typeof REALTIME_EFFORTS)[number]

const params = {
  model: Flag.string('Realtime voice model (gpt-realtime-2.1, or gpt-realtime-2.1-mini for cheaper sessions)', {
    default: () => 'gpt-realtime-2.1',
  }),
  voice: Flag.string('Voice for spoken replies (ballad is the British male; also cedar, marin, alloy, ash, ...)', {
    default: () => 'ballad',
  }),
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

const VOICE_PROMPT_FILE = new URL('./prompts/voice.prompt.md', import.meta.url).pathname
const ASK_PROMPT_FILE = new URL('./prompts/ask-notebook.prompt.md', import.meta.url).pathname

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

    // Both prompts carry the session-start clocks.
    const renderInput: RenderInput = {
      context: {
        notebookDate: context.notebookNow.date,
        notebookTime: context.notebookNow.time,
        notebookTimezone: context.notebookNow.timezone,
        systemDate: context.systemNow.date,
        systemTime: context.systemNow.time,
        systemTimezone: context.systemNow.timezone,
      },
    }
    const { output: sessionInstructions } = renderPromptFile(
      await readTextFile(VOICE_PROMPT_FILE),
      'voice.prompt.md',
      renderInput,
    )
    const { output: askPrompt } = renderPromptFile(
      await readTextFile(ASK_PROMPT_FILE),
      'ask-notebook.prompt.md',
      renderInput,
    )
    // The me namespace comes from the AboutMe profile; the #if guard keeps
    // the line well-formed when no profile exists.
    const { output: greeting } = renderTemplate(
      'Hello{{#if me.firstName}} {{me.firstName}}{{/if}}. What would you like to talk about?',
      renderInput,
    )

    output.log(colors.bold('Voice session'))
    output.log(colors.dim(`  ${args.model} · voice ${args.voice} · delegate ${args.reasoning}`))
    output.log(colors.dim('  Tool: ask_notebook · Ctrl+C to end'))

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
      instructions: sessionInstructions,
      greeting,
      effort: args.effort as RealtimeEffort | undefined,
      createEngine: (callbacks) =>
        helperBinary ? new DuplexAudio(helperBinary, callbacks) : new FfmpegAudio(micDevice, callbacks),
      tools: [ASK_NOTEBOOK_TOOL],
      executeTool: async (name, input) => {
        if (name !== 'ask_notebook') return `Unknown tool: ${name}`
        const question = typeof input.question === 'string' ? input.question.trim() : ''
        if (!question) return 'ask_notebook needs a question.'
        output.log(colors.dim(`ask_notebook: "${truncate(question, 100)}"`))
        const t0 = performance.now()
        const result = await askNotebook(tasks, delegateModel, askPrompt, question)
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
