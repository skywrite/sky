import type { LanguageModelMiddleware } from 'ai'

/**
 * Fold every system message into one at the front of the prompt.
 *
 * The prompt-cache helpers split instructions into several system messages so
 * each segment can carry its own Anthropic cache breakpoint. OpenAI-compatible
 * hosts with a strict chat template — Cerebras among them — reject a request
 * whose system messages are not one message at position zero ("System message
 * must be at the beginning"). This middleware joins the segments in order with
 * a blank line, drops their provider options (cache breakpoints mean nothing to
 * these hosts), and leaves the rest of the prompt untouched. A prompt with at
 * most one system message, already first, passes through as the same reference.
 */
export const singleSystemMessageMiddleware: LanguageModelMiddleware = {
  async transformParams({ params }) {
    const prompt = params.prompt
    const systems = prompt.filter((m) => m.role === 'system')
    const alreadyOne = systems.length <= 1 && (systems.length === 0 || prompt[0].role === 'system')
    if (alreadyOne) return params

    const content = systems
      .map((m) => (typeof m.content === 'string' ? m.content : '').trim())
      .filter((s) => s !== '')
      .join('\n\n')
    const rest = prompt.filter((m) => m.role !== 'system')
    return { ...params, prompt: [{ role: 'system', content }, ...rest] }
  },
}

export default singleSystemMessageMiddleware
