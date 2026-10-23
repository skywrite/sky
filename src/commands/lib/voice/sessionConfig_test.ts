import { assert, test } from '#test'
import {
  auditionSessionConfig,
  DEFAULT_VOICE,
  openingInstructions,
  preferredVoice,
  renderVoicePrompts,
  VOICE_GROUPS,
  VOICES,
  voiceSessionConfig,
} from './sessionConfig.ts'

const CLOCK = {
  notebookDate: '2026-01-27',
  notebookTime: '09:30',
  notebookTimezone: 'Europe/London',
  systemDate: '2026-01-27',
  systemTime: '09:30',
  systemTimezone: 'Europe/London',
}

test('voice config selects GPT-Live with Sol 6.1 Ultrafast high and delegates optional tool schemas', () => {
  const session = voiceSessionConfig({
    voice: 'marin',
    instructions: 'Be Sky.',
    backendInstructions: 'Use verified records.',
    tools: [
      {
        type: 'function',
        name: 'query_notebook',
        parameters: { type: 'object', properties: { type: { type: 'string' } } },
      },
    ],
  })
  assert({
    given: 'the browser voice configuration',
    should: 'use the requested models and keep processing out of the speech prompt',
    actual: session,
    expected: {
      model: 'gpt-live-1',
      instructions: 'Be Sky.',
      audio: { output: { voice: 'marin' } },
      store: false,
      delegation: {
        type: 'responses',
        responses: {
          model: 'gpt-6.1-sol',
          service_tier: 'ultrafast',
          reasoning: { effort: 'high' },
          instructions: 'Use verified records.',
          parallel_tool_calls: true,
          tool_choice: 'auto',
          tools: [
            {
              type: 'function',
              name: 'query_notebook',
              parameters: { type: 'object', properties: { type: { type: 'string' } } },
              strict: false,
            },
          ],
        },
      },
    },
  })
})

test('voice config keeps the selected Sky voice and previews it without notebook or backend access', () => {
  const preview = auditionSessionConfig('ash')
  assert({
    given: 'voice preferences and an audition',
    should: 'honor the selection, retain the default, and use a tool-free Live preview',
    actual: [
      DEFAULT_VOICE,
      preferredVoice('ash'),
      preferredVoice('unknown'),
      preview.model,
      preview.audio?.output?.voice,
      preview.delegation,
      preview.store,
    ],
    expected: ['marin', 'ash', 'marin', 'gpt-live-1', 'ash', { type: 'client' }, false],
  })
  assert({
    given: 'the voice groups',
    should: 'cover each offered voice once',
    actual: [...VOICE_GROUPS.male, ...VOICE_GROUPS.female].toSorted(),
    expected: [...VOICES].toSorted(),
  })
})

test('voice prompts retain evidence and action rules in the backend while Live receives conversation policy', async () => {
  const evidence = 'Jane Doe prefers a short explanation. Atlas <beta> is awaiting review; current status is unknown.'
  const calendar = 'Synthetic appointment at 10:00.'
  const prompts = await renderVoicePrompts({ ...CLOCK, notebookContext: evidence, calendar })
  assert({
    given: 'a bounded notebook snapshot and calendar',
    should: 'preserve source text and clocks in the backend without crowding the live prompt',
    actual: [
      prompts.askPrompt.includes(evidence),
      prompts.askPrompt.includes(calendar),
      prompts.askPrompt.includes('2026-01-27 09:30 (Europe/London)'),
      prompts.instructions.includes(evidence),
      prompts.instructions.includes(calendar),
      /{{/.test(prompts.askPrompt + prompts.instructions),
    ],
    expected: [true, true, true, false, false, false],
  })
  assert({
    given: 'task procedures and delegation policy',
    should: 'retain confirmation, sent-mail checks, source limits, and conversational interruptions',
    actual: [
      prompts.askPrompt.includes('confirm_action'),
      prompts.askPrompt.includes('in:sent'),
      prompts.askPrompt.includes('past output'),
      prompts.askPrompt.includes('private notebook'),
      prompts.askPrompt.includes('calendar_schedule'),
      prompts.instructions.includes('## Interruption policy'),
      prompts.instructions.includes('correction, confirmation, cancellation'),
      /Sonny|Sunny|invite_sonny|research_together/.test(prompts.askPrompt + prompts.instructions),
    ],
    expected: [true, true, true, true, true, true, true, false],
  })
})

test('the opening cue is short and an existing chat does not restart earlier tasks', () => {
  assert({
    given: 'a new or continuing conversation',
    should: 'supply a short greeting cue without replacing the session prompt',
    actual: [
      openingInstructions('Hey Jane.').includes('"Hey Jane."'),
      openingInstructions('Hey Jane.', true).includes('Do not repeat earlier replies or start earlier tasks again.'),
    ],
    expected: [true, true],
  })
})
