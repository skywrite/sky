/**
 * Prompt types for interactive tasks
 *
 * Tasks can yield Prompt objects when they need user input.
 * The runtime collects input and sends it back via generator.next(response).
 *
 * For one-way notifications (progress, logs), use context.output.log() instead.
 */

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface PromptText {
  type: 'text'
  id: string
  message: string
  default?: string
  placeholder?: string
}

export interface PromptSelect {
  type: 'select'
  id: string
  message: string
  options: { label: string; value: string }[]
  default?: string
}

export interface PromptConfirm {
  type: 'confirm'
  id: string
  message: string
  default?: boolean
}

export type Prompt = PromptText | PromptSelect | PromptConfirm

// -----------------------------------------------------------------------------
// Factory functions
// -----------------------------------------------------------------------------

export const Prompt = {
  text(id: string, message: string, opts?: Partial<Omit<PromptText, 'type' | 'id' | 'message'>>): PromptText {
    return { type: 'text', id, message, ...opts }
  },

  select(
    id: string,
    message: string,
    options: PromptSelect['options'],
    opts?: Partial<Omit<PromptSelect, 'type' | 'id' | 'message' | 'options'>>,
  ): PromptSelect {
    return { type: 'select', id, message, options, ...opts }
  },

  confirm(id: string, message: string, opts?: Partial<Omit<PromptConfirm, 'type' | 'id' | 'message'>>): PromptConfirm {
    return { type: 'confirm', id, message, ...opts }
  },
}
