import type { RealtimeFunctionTool, RealtimeSessionCreateRequest } from 'openai/resources/realtime/realtime'
/**
 * What a voice session is, apart from how its audio travels: the persona
 * rendered with the session-start clocks, an opening line, the
 * ask_notebook delegate's prompt, and the Realtime session configuration.
 *
 * Two transports send that configuration. The terminal sends it over its
 * server WebSocket, where PCM flows both ways and so the format is
 * declared. The browser connects over WebRTC with a client secret minted
 * around it, where the audio format is WebRTC's to negotiate and so is
 * not declared at all.
 */
import { loadSkyConfig } from '#shared/config/loader.ts'
import { readPromptFile } from '#shared/prompts/load.ts'
import { type RenderInput, renderPromptFile, renderTemplate } from '#shared/prompts/mod.ts'
import { pickGreeting } from './greetings.ts'

/** Full realtime model, not mini — a ruling. */
export const DEFAULT_VOICE_MODEL = 'gpt-realtime-2.1'
/** Every voice the Realtime API offers, as the SDK lists them. */
export const VOICES = ['alloy', 'ash', 'ballad', 'cedar', 'coral', 'echo', 'marin', 'sage', 'shimmer', 'verse'] as const
export type Voice = (typeof VOICES)[number]
/**
 * Chosen by ear on 2026-08-30 from an audition of all ten: a peer's
 * register, not a companion's. The voice is the voice — the prompt no
 * longer tells it how to sound.
 */
export const DEFAULT_VOICE: Voice = 'ash'
export const DEFAULT_RESEARCHER_NAME = 'Sunny'
export const DEFAULT_RESEARCHER_VOICE: Voice = 'marin'
/** Browser calls open with a hello, leaving the user to set the topic. */
export const BROWSER_GREETING_TEMPLATE = 'Hey{{#if me.firstName}} {{me.firstName}}{{/if}}.'

/** A local handoff to Sunny's speaking session; no notebook research is required. */
export const INVITE_SUNNY_TOOL: RealtimeFunctionTool = {
  type: 'function',
  name: 'invite_sunny',
  description:
    'Let Sunny speak next for greetings, conversation, or an opinion the existing evidence can support. ' +
    'This only invites her to speak; it does not run research. For a requested deep investigation, including ' +
    'one specified before the latest topic clarification, use research_web for public questions or ' +
    'research_notebook for notebook questions. No research topic is required for a greeting. Pass a ' +
    'self-contained request faithful to the user’s words, without adding a mood, topic, question, or greeting ' +
    'script they did not ask for. Then yield immediately: do not narrate tool mechanics or answer ' +
    'for her.',
  parameters: {
    type: 'object',
    properties: {
      request: {
        type: 'string',
        minLength: 1,
        maxLength: 12_000,
        description:
          'The user’s actual conversational intent, preferably in their own words. Add context only to resolve ' +
          'references; do not invent a mood, extra question, topic menu, or instructions to perform a greeting.',
      },
    },
    required: ['request'],
    additionalProperties: false,
  },
}

/**
 * The voice sessions actually use: `voice.voice` from ~/.sky/config.jsonc
 * when it names a real voice, else the default. Read per session, so a
 * change from the settings page applies to the next call, no restart.
 */
export function preferredVoice(configured: string | undefined = loadSkyConfig().voice.voice): Voice {
  return (VOICES as readonly string[]).includes(configured ?? '') ? (configured as Voice) : DEFAULT_VOICE
}

/** Resolve the researcher's independent preference at the start of each browser call. */
export function preferredResearcherVoice(
  configured: string | undefined = loadSkyConfig().voice.researcherVoice,
): Voice {
  return (VOICES as readonly string[]).includes(configured ?? '') ? (configured as Voice) : DEFAULT_RESEARCHER_VOICE
}

/** By ear — OpenAI does not label them. Alloy is neutral and sits with the women. */
export const VOICE_GROUPS: Readonly<Record<'male' | 'female', readonly Voice[]>> = {
  male: ['ash', 'ballad', 'cedar', 'echo', 'verse'],
  female: ['alloy', 'coral', 'marin', 'sage', 'shimmer'],
}

/**
 * What the audition page opens with: the greeting's shape, a little
 * longer, so a voice's cadence can be heard. A template for
 * renderTemplate, like the greetings.
 */
export const AUDITION_PASSAGE =
  "Hey{{#if me.firstName}} {{me.firstName}}{{/if}}, I'm Sky — I've got your notebook right here. " +
  'Ask me anything, or just think out loud.'

/**
 * A session that only speaks: one voice, the persona, no tools, no
 * listening. The page asks for exactly one response — the passage.
 */
export function auditionSessionConfig(voice: Voice, instructions: string): RealtimeSessionCreateRequest {
  return {
    type: 'realtime',
    model: DEFAULT_VOICE_MODEL,
    output_modalities: ['audio'],
    instructions,
    audio: { output: { voice } },
    tracing: null,
  }
}

/** Sunny's receive-only conversation session. Invitations and research results arrive through the host. */
export function researcherSessionConfig({
  voice = preferredResearcherVoice(),
  instructions,
  model = DEFAULT_VOICE_MODEL,
}: {
  voice?: string
  instructions: string
  model?: string
}): RealtimeSessionCreateRequest {
  return {
    type: 'realtime',
    model,
    output_modalities: ['audio'],
    instructions,
    audio: { input: { turn_detection: null }, output: { voice } },
    tools: [],
    tool_choice: 'none',
    tracing: null,
  }
}

export const REALTIME_EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh'] as const
export type RealtimeEffort = (typeof REALTIME_EFFORTS)[number]
/** Browser host reconciles notebook status and live evidence before speaking. */
export const BROWSER_VOICE_EFFORT: RealtimeEffort = 'medium'

const VOICE_PROMPT_FILE = new URL('./prompts/voice.prompt.md', import.meta.url).pathname
const ASK_PROMPT_FILE = new URL('./prompts/ask-notebook.prompt.md', import.meta.url).pathname
const RESEARCHER_PROMPT_FILE = new URL('./prompts/researcher.prompt.md', import.meta.url).pathname

/** The two clocks every voice prompt carries, as CommandContext reports them. */
export interface VoiceClock {
  notebookDate: string
  notebookTime: string
  notebookTimezone: string
  systemDate: string
  systemTime: string
  systemTimezone: string
}

export interface VoicePrompts {
  /** The session's system instructions: persona, voice, the notebook rules, today's calendar. */
  instructions: string
  /** The ask_notebook delegate's system prompt. */
  askPrompt: string
  /** Sunny's instructions for direct conversation and presenting actual research results. */
  researcherInstructions: string
  /** The opening line, its name slot already filled from the AboutMe profile. */
  greeting: string
}

export interface VoicePromptInput extends VoiceClock {
  /** Bounded, source-labelled notebook snapshot shared with the research delegate. */
  notebookContext?: string
  /** Browser host with fast lookup, deep research, and Sunny's separate speaking session. */
  dualVoice?: boolean
  /**
   * The day's calendar checked against the notebook's meeting records,
   * rendered by the host (day:meeting:check's lib). Absent when the host
   * did not check.
   */
  calendar?: string
}

/** Render the personas, delegate prompt, and transport's greeting for one session. */
export async function renderVoicePrompts(input: VoicePromptInput, random?: () => number): Promise<VoicePrompts> {
  const { calendar, notebookContext, dualVoice = false, ...clock } = input
  const renderInput: RenderInput = {
    context: { ...clock },
    calendar: { block: calendar ?? '' },
    voiceContext: { block: notebookContext ?? '' },
    researcher: { name: DEFAULT_RESEARCHER_NAME, enabled: dualVoice },
  }
  const { output: instructions } = renderPromptFile(
    await readPromptFile(VOICE_PROMPT_FILE),
    'voice.prompt.md',
    renderInput,
  )
  const { output: askPrompt } = renderPromptFile(
    await readPromptFile(ASK_PROMPT_FILE),
    'ask-notebook.prompt.md',
    renderInput,
  )
  const { output: researcherInstructions } = renderPromptFile(
    await readPromptFile(RESEARCHER_PROMPT_FILE),
    'researcher.prompt.md',
    renderInput,
  )
  const { output: greeting } = renderTemplate(dualVoice ? BROWSER_GREETING_TEMPLATE : pickGreeting(random), renderInput)
  return { instructions, askPrompt, researcherInstructions, greeting }
}

export interface VoiceSessionSpec {
  model: string
  voice: string
  instructions: string
  tools: RealtimeFunctionTool[]
  /** Realtime reasoning effort — omitted means the server default. */
  effort?: RealtimeEffort
  /** Declared only by a transport that streams raw PCM itself; the API speaks 24 kHz. */
  pcmRate?: 24000
  /** Emit speech events while the browser coordinates which participant may speak. */
  manualTurns?: boolean
}

/** The session configuration both transports send, differing only in whether audio is declared. */
export function voiceSessionConfig(spec: VoiceSessionSpec): RealtimeSessionCreateRequest {
  const { model, voice, instructions, tools, effort, pcmRate, manualTurns } = spec
  const format = pcmRate ? { format: { type: 'audio/pcm' as const, rate: pcmRate } } : {}
  return {
    type: 'realtime',
    model,
    output_modalities: ['audio'],
    instructions,
    audio: {
      input: {
        ...format,
        // Server-side noise filtering helps VAD whatever the microphone.
        noise_reduction: { type: 'near_field' },
        transcription: { model: 'gpt-live-transcribe' },
        turn_detection: {
          type: 'semantic_vad',
          ...(manualTurns ? { create_response: false, interrupt_response: false } : {}),
        },
      },
      output: { ...format, voice },
    },
    tools,
    tool_choice: 'auto',
    // Notebook content must not land in OpenAI's traces dashboard.
    tracing: null,
    ...(effort ? { reasoning: { effort } } : {}),
  }
}

/**
 * Instructions for the greeting response. Per-response instructions are
 * that response's whole system message — they stand in for the session's
 * — so the persona rides along, or the first utterance, which sets the
 * tone for the rest of the session, is spoken with no direction at all.
 */
export function openingInstructions(instructions: string, greeting: string): string {
  return (
    `${instructions}\n\n## Opening line\n\nThe session has just started. ` +
    `Say exactly this, and nothing else: "${greeting}"`
  )
}
