import { assert, test } from '#test'
import {
  auditionSessionConfig,
  DEFAULT_RESEARCHER_NAME,
  DEFAULT_RESEARCHER_VOICE,
  DEFAULT_VOICE,
  INVITE_SONNY_TOOL,
  openingInstructions,
  preferredResearcherVoice,
  preferredVoice,
  renderVoicePrompts,
  researcherSessionConfig,
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

const TOOL = {
  type: 'function' as const,
  name: 'lookup_notebook',
  description: 'probe',
  parameters: { type: 'object' },
}

test({ name: 'voice session config - browser calls let WebRTC negotiate the audio format' }, () => {
  const spec = { model: 'gpt-realtime-2.1', voice: 'marin', instructions: 'Be Sky.', tools: [TOOL] }

  const webrtc = voiceSessionConfig(spec)
  assert({
    given: 'a browser session',
    should: 'leave the audio format to WebRTC',
    actual: [webrtc.audio?.input?.format, webrtc.audio?.output?.format],
    expected: [undefined, undefined],
  })
  assert({
    given: 'a browser session',
    should: 'configure the voice, speech detection, transcription, and tools',
    actual: {
      type: webrtc.type,
      model: webrtc.model,
      voice: webrtc.audio?.output?.voice,
      vad: webrtc.audio?.input?.turn_detection,
      transcription: webrtc.audio?.input?.transcription,
      tools: webrtc.tools,
      tracing: webrtc.tracing,
      reasoning: webrtc.reasoning,
    },
    expected: {
      type: 'realtime',
      model: 'gpt-realtime-2.1',
      voice: 'marin',
      vad: { type: 'semantic_vad' },
      transcription: { model: 'gpt-live-transcribe' },
      tools: [TOOL],
      tracing: null,
      reasoning: undefined,
    },
  })
  assert({
    given: 'an effort',
    should: 'set it as the reasoning effort',
    actual: voiceSessionConfig({ ...spec, effort: 'low' }).reasoning,
    expected: { effort: 'low' },
  })
  assert({
    given: 'a browser call whose floor manager controls responses and interruptions',
    should: 'keep speech detection but disable automatic turns only when requested',
    actual: [
      voiceSessionConfig({ ...spec, manualTurns: true }).audio?.input?.turn_detection,
      voiceSessionConfig({ ...spec, manualTurns: false }).audio?.input?.turn_detection,
    ],
    expected: [{ type: 'semantic_vad', create_response: false, interrupt_response: false }, { type: 'semantic_vad' }],
  })
})

test({ name: 'voice session config - Sonny speaks on explicit invitations and research turns' }, () => {
  const session = researcherSessionConfig({ voice: 'ash', instructions: 'Present the supplied findings.' })
  assert({
    given: 'a researcher presentation session',
    should: 'use a separate voice with no automatic listening, tools, or tracing',
    actual: {
      type: session.type,
      model: session.model,
      instructions: session.instructions,
      modalities: session.output_modalities,
      audio: session.audio,
      tools: session.tools,
      toolChoice: session.tool_choice,
      tracing: session.tracing,
    },
    expected: {
      type: 'realtime',
      model: 'gpt-realtime-2.1',
      instructions: 'Present the supplied findings.',
      modalities: ['audio'],
      audio: { input: { turn_detection: null }, output: { voice: 'ash' } },
      tools: [],
      toolChoice: 'none',
      tracing: null,
    },
  })
  assert({
    given: 'a valid voice preference or an invalid/missing value',
    should: 'honor valid preferences and fall back to Sonny’s default voice',
    actual: [
      DEFAULT_RESEARCHER_NAME,
      DEFAULT_RESEARCHER_VOICE,
      ...['sage', 'unknown', ''].map(preferredResearcherVoice),
    ],
    expected: ['Sonny', 'ash', 'sage', 'ash', 'ash'],
  })
  assert({
    given: 'Sky’s default and valid or invalid voice preferences',
    should: 'use marin by default while honoring an explicit voice choice',
    actual: [DEFAULT_VOICE, ...['ash', 'unknown', ''].map(preferredVoice)],
    expected: ['marin', 'ash', 'marin', 'marin'],
  })
})

test({ name: 'voice session config - the groups cover every voice once, and an audition only speaks' }, () => {
  const grouped = [...VOICE_GROUPS.male, ...VOICE_GROUPS.female].toSorted()
  assert({
    given: 'the male and female groups',
    should: 'partition the voice list',
    actual: grouped,
    expected: [...VOICES].toSorted(),
  })
  const session = auditionSessionConfig('ash', 'Be Sky.')
  assert({
    given: 'an audition session',
    should: 'carry the voice and persona and nothing to listen with',
    actual: [session.audio?.output?.voice, session.instructions, session.tools, session.audio?.input, session.tracing],
    expected: ['ash', 'Be Sky.', undefined, undefined, null],
  })
})

test({ name: 'voice session config - the opening line carries the persona' }, () => {
  const opening = openingInstructions('You are Sky. Confident, composed.', 'Hey Jane, ready when you are.')
  assert({
    given: 'the session instructions and a greeting',
    should: 'put the persona first and quote the greeting verbatim',
    actual: [
      opening.startsWith('You are Sky. Confident, composed.'),
      opening.includes('## Opening line'),
      opening.endsWith('"Hey Jane, ready when you are."'),
    ],
    expected: [true, true, true],
  })
})

test({ name: 'voice session config - the prompts render with the clocks and a greeting' }, async () => {
  const prompts = await renderVoicePrompts(CLOCK, () => 0)
  assert({
    given: 'the session-start clocks',
    should: 'stamp the host, engine, and research presenter prompts with them',
    actual: [
      prompts.instructions.includes('2026-01-27 09:30 (Europe/London)'),
      prompts.askPrompt.includes('2026-01-27 09:30 (Europe/London)'),
      prompts.researcherInstructions.includes('2026-01-27 09:30 (Europe/London)'),
    ],
    expected: [true, true, true],
  })
  assert({
    given: 'a fixed draw',
    should: 'open with hey and the first phrase',
    actual: prompts.greeting.startsWith('Hey') && prompts.greeting.endsWith(', what would you like to talk about?'),
    expected: true,
  })
  assert({
    given: 'no calendar from the host',
    should: 'render no calendar section',
    actual: prompts.instructions.includes("## Today's calendar"),
    expected: false,
  })
  assert({
    given: 'no initial notebook context from the host',
    should: 'omit its heading in all three prompts and resolve all template expressions',
    actual: [prompts.instructions, prompts.askPrompt, prompts.researcherInstructions].map((prompt) => ({
      hasContextHeading: prompt.includes('## Initial notebook context'),
      hasTemplateExpression: prompt.includes('{{'),
    })),
    expected: [
      { hasContextHeading: false, hasTemplateExpression: false },
      { hasContextHeading: false, hasTemplateExpression: false },
      { hasContextHeading: false, hasTemplateExpression: false },
    ],
  })
})

test({ name: 'voice session config - host and researcher receive the same initial notebook evidence' }, async () => {
  const notebookContext = [
    'Snapshot captured: 2026-01-27 09:30 (Europe/London).',
    '',
    '## Preferences — about/preferences.md — undated',
    'Jane Doe prefers direct recommendations & a brief explanation.',
    '',
    '## Goals — goals.md — 2026-01-26',
    'Ship Atlas <beta> after the review.',
    '',
    'Recent summaries were unavailable; this does not establish that there was no recent activity.',
  ].join('\n')
  const prompts = await renderVoicePrompts({ ...CLOCK, notebookContext, dualVoice: true }, () => 0)

  assert({
    given: 'dated source evidence, special characters, and a collection limitation from the host',
    should: 'preserve the whole block under its heading in all three prompts',
    actual: [prompts.instructions, prompts.askPrompt, prompts.researcherInstructions].map((prompt) =>
      prompt.includes(`## Initial notebook context\n\n${notebookContext}\n`),
    ),
    expected: [true, true, true],
  })
  assert({
    given: 'two participants and notebook evidence that can make the prompt long',
    should: 'anchor both identities and the Sunny spelling before the notebook evidence in each speech prompt',
    actual: [prompts.instructions, prompts.researcherInstructions].map((prompt) => {
      const roster = prompt.slice(0, prompt.indexOf('## Initial notebook context'))
      return {
        sky: /Sky \((?:you, )?she\/her\)/.test(roster),
        sonny: /Sonny \((?:you, )?he\/him\)/.test(roster),
        alias: roster.includes('"Sunny" is another spelling'),
      }
    }),
    expected: [
      { sky: true, sonny: true, alias: true },
      { sky: true, sonny: true, alias: true },
    ],
  })
})

test(
  { name: 'voice session config - the calendar rides in the session instructions, not the delegate prompt' },
  async () => {
    const calendar = 'No meetings on the calendar for 2026-01-27 (Europe/London), as of 2026-01-27 09:30.'
    const prompts = await renderVoicePrompts({ ...CLOCK, calendar }, () => 0)
    assert({
      given: 'a rendered calendar check',
      should: 'place it under its heading in the instructions only',
      actual: [
        prompts.instructions.includes(`## Today's calendar\n\n${calendar}\n`),
        prompts.askPrompt.includes(calendar),
        prompts.researcherInstructions.includes(calendar),
      ],
      expected: [true, false, false],
    })
  },
)

test(
  { name: 'voice session config - only dual voice hosts receive Sonny and the browser notebook tools' },
  async () => {
    const calendar = 'No meetings on the calendar for 2026-01-27.'
    const single = await renderVoicePrompts({ ...CLOCK, calendar }, () => 0)
    const dual = await renderVoicePrompts({ ...CLOCK, calendar, dualVoice: true }, () => 0)
    const toolNames = [
      'ask_notebook',
      'lookup_notebook',
      'research_notebook',
      'lookup_web',
      'search_email',
      'research_web',
      'resume_research',
      'invite_sonny',
      'research_together',
      'Sonny',
    ]
    assert({
      given: 'the single voice audition persona, including its calendar instructions',
      should: 'avoid claiming research or a second participant',
      actual: toolNames.map((name) => single.instructions.includes(name)),
      expected: [false, false, false, false, false, false, false, false, false, false],
    })
    assert({
      given: 'an explicitly enabled dual voice host',
      should: 'describe direct conversation, notebook and web lookup/research, and saved-report resumption with Sonny',
      actual: toolNames.map((name) => dual.instructions.includes(name)),
      expected: [false, true, true, true, true, true, true, true, true, true],
    })
    assert({
      given: 'a shared public/notebook assignment',
      should: 'preserve the split and complete the comparison after Sonny speaks',
      actual: {
        sharedFirst: dual.instructions.includes('Choose research_together first'),
        separateQuestions: dual.instructions.includes(
          'public-only web_question and a separate, self-contained notebook_question',
        ),
        speakerOrder: dual.instructions.includes(
          'you give the web overview first, Sonny adds the notebook findings and comparison, then you bring both together',
        ),
        standaloneDepth: dual.instructions.includes(
          'For a standalone assignment, explicit deep research takes priority',
        ),
        sonnyCompares: dual.researcherInstructions.includes(
          'your turn connects what the notebook establishes with the supplied public evidence',
        ),
        noSecondPublicReport: dual.researcherInstructions.includes(
          "do not repeat Sky's public overview or prepare a separate second public report",
        ),
      },
      expected: {
        sharedFirst: true,
        separateQuestions: true,
        speakerOrder: true,
        standaloneDepth: true,
        sonnyCompares: true,
        noSecondPublicReport: true,
      },
    })
    assert({
      given: 'the user asks whether Sonny is present, including the Sunny spelling',
      should: 'let Sonny answer rather than have Sky speak for him',
      actual: {
        routesPresence: dual.instructions.includes(
          '"Is Sonny here?", "Sunny there?", and "I\'d like to hear from Sonny" all go straight to invite_sonny',
        ),
        oldHostAnswer: dual.instructions.includes('"Yep, he\'s here."'),
        invitationAlias: INVITE_SONNY_TOOL.description?.includes('also heard as Sunny'),
      },
      expected: { routesPresence: true, oldHostAnswer: false, invitationAlias: true },
    })
    assert({
      given: 'the same single and dual voice sessions',
      should: 'describe public web evidence tools only for the browser research engine',
      actual: [single, dual].map((prompts) => prompts.askPrompt.includes('read_web_page')),
      expected: [false, true],
    })
    assert({
      given: 'either host mode',
      should: 'resolve the conditional template and still produce the researcher presentation instructions',
      actual: [single, dual].map((prompts) => ({
        unresolved: prompts.instructions.includes('{{'),
        researcher: prompts.researcherInstructions.startsWith('You are Sonny'),
        skyPronouns: prompts.instructions.includes('Use I/me for yourself and she/her'),
        sonnyPronouns: prompts.researcherInstructions.includes('Use I/me for yourself and he/him'),
        researcherKnowsSky: prompts.researcherInstructions.includes('Refer to Sky by her name or she/her'),
      })),
      expected: [
        { unresolved: false, researcher: true, skyPronouns: true, sonnyPronouns: true, researcherKnowsSky: true },
        { unresolved: false, researcher: true, skyPronouns: true, sonnyPronouns: true, researcherKnowsSky: true },
      ],
    })
  },
)

test(
  { name: 'voice session config - inviting Sonny requires a conversational request rather than research parameters' },
  () => {
    const session = voiceSessionConfig({
      model: 'gpt-realtime-2.1',
      voice: 'ash',
      instructions: 'Let Sonny answer when invited.',
      tools: [INVITE_SONNY_TOOL],
      manualTurns: true,
    })
    const invite = session.tools?.find((tool) => tool.type === 'function' && tool.name === 'invite_sonny')
    const parameters = (invite?.type === 'function' ? invite.parameters : undefined) as
      | {
          properties?: Record<string, Record<string, unknown>>
          required?: unknown
          additionalProperties?: unknown
        }
      | undefined
    const request = parameters?.properties?.request
    assert({
      given: 'the browser host offers a direct speaking invitation',
      should: 'expose one bounded conversational request without requiring a research question or topic',
      actual:
        invite?.type === 'function'
          ? {
              name: invite.name,
              required: parameters?.required,
              fields: Object.keys((parameters?.properties ?? {}) as Record<string, unknown>),
              request: { type: request?.type, minLength: request?.minLength, maxLength: request?.maxLength },
              additionalProperties: parameters?.additionalProperties,
            }
          : undefined,
      expected: {
        name: 'invite_sonny',
        required: ['request'],
        fields: ['request'],
        request: { type: 'string', minLength: 1, maxLength: 12_000 },
        additionalProperties: false,
      },
    })
  },
)
