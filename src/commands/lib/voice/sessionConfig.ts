/** GPT-Live speaks; a managed Responses backend reasons and selects tools. */
import type { FunctionTool, MediaSessionConfig } from 'openai/resources/live/live'
import { loadSkyConfig } from '#shared/config/loader.ts'
import { readPromptFile } from '#shared/prompts/load.ts'
import { type RenderInput, renderPromptFile, renderTemplate } from '#shared/prompts/mod.ts'

export const DEFAULT_VOICE_MODEL = 'gpt-live-1'
export const VOICE_PROCESSING_MODEL = 'gpt-6.1-sol'
export const VOICE_PROCESSING_TIER = 'ultrafast'
export const VOICE_PROCESSING_EFFORT = 'high'

/** Keep the existing, auditioned voice selection. Live supports all of these. */
export const VOICES = ['alloy', 'ash', 'ballad', 'cedar', 'coral', 'echo', 'marin', 'sage', 'shimmer', 'verse'] as const
export type Voice = (typeof VOICES)[number]
export const DEFAULT_VOICE: Voice = 'marin'
export const BROWSER_GREETING_TEMPLATE = 'Hey{{#if me.firstName}} {{me.firstName}}{{/if}}.'

export function preferredVoice(configured: string | undefined = loadSkyConfig().voice.voice): Voice {
  return (VOICES as readonly string[]).includes(configured ?? '') ? (configured as Voice) : DEFAULT_VOICE
}

/** By ear — OpenAI does not label them. Alloy is neutral and sits with the women. */
export const VOICE_GROUPS: Readonly<Record<'male' | 'female', readonly Voice[]>> = {
  male: ['ash', 'ballad', 'cedar', 'echo', 'verse'],
  female: ['alloy', 'coral', 'marin', 'sage', 'shimmer'],
}

export const AUDITION_PASSAGE =
  "Hey{{#if me.firstName}} {{me.firstName}}{{/if}}, I'm Sky — I've got your notebook right here. " +
  'Ask me anything, or just think out loud.'

const VOICE_PROMPT_FILE = new URL('./prompts/voice.prompt.md', import.meta.url).pathname
const ASK_PROMPT_FILE = new URL('./prompts/ask-notebook.prompt.md', import.meta.url).pathname

export interface VoiceClock {
  notebookDate: string
  notebookTime: string
  notebookTimezone: string
  systemDate: string
  systemTime: string
  systemTimezone: string
}

export interface VoicePrompts {
  instructions: string
  /** Notebook evidence, tool procedures, and confirmation rules belong to Sol. */
  askPrompt: string
  greeting: string
}

export interface VoicePromptInput extends VoiceClock {
  notebookContext?: string
  calendar?: string
}

export async function renderVoicePrompts(input: VoicePromptInput): Promise<VoicePrompts> {
  const { calendar, notebookContext, ...clock } = input
  const renderInput: RenderInput = {
    context: { ...clock },
    calendar: { block: calendar ?? '' },
    voiceContext: { block: notebookContext ?? '' },
  }
  const [voice, backend] = await Promise.all([readPromptFile(VOICE_PROMPT_FILE), readPromptFile(ASK_PROMPT_FILE)])
  return {
    instructions: renderPromptFile(voice, 'voice.prompt.md', renderInput).output,
    askPrompt: renderPromptFile(backend, 'ask-notebook.prompt.md', renderInput).output,
    greeting: renderTemplate(BROWSER_GREETING_TEMPLATE, renderInput).output,
  }
}

export interface VoiceSessionSpec {
  voice: Voice
  instructions: string
  backendInstructions: string
  tools: FunctionTool[]
}

/** WebRTC negotiates audio. Live owns speech timing; there is no Realtime VAD or response trigger. */
export function voiceSessionConfig(spec: VoiceSessionSpec): MediaSessionConfig {
  return {
    model: DEFAULT_VOICE_MODEL,
    instructions: spec.instructions,
    audio: { output: { voice: spec.voice } },
    store: false,
    delegation: {
      type: 'responses',
      responses: {
        model: VOICE_PROCESSING_MODEL,
        service_tier: VOICE_PROCESSING_TIER,
        reasoning: { effort: VOICE_PROCESSING_EFFORT },
        instructions: spec.backendInstructions,
        // Existing command schemas have optional fields; do not let Responses
        // normalize them into required fields via its default strict mode.
        tools: spec.tools.map((tool) => ({ ...tool, strict: false })),
        parallel_tool_calls: true,
        tool_choice: 'auto',
      },
    },
  }
}

/** Previews use the same voice model without notebook context or backend work. */
export function auditionSessionConfig(voice: Voice): MediaSessionConfig {
  return {
    model: DEFAULT_VOICE_MODEL,
    instructions:
      'You are Sky, a warm, natural voice. Wait silently until the application supplies the preview passage. ' +
      'Speak that passage once, without additions, then remain silent. Never delegate or use tools.',
    audio: { output: { voice } },
    delegation: { type: 'client' },
    store: false,
  }
}

/** A short Live context append after playback is ready, never a Realtime response.create. */
export function openingInstructions(greeting: string, continuing = false): string {
  return continuing
    ? 'The audio is ready. The user switched this existing chat to voice. Briefly acknowledge that you are listening, then pause. Do not repeat earlier replies or start earlier tasks again.'
    : `The audio is ready. Immediately greet the user by saying exactly ${JSON.stringify(greeting)}, then pause and listen.`
}
