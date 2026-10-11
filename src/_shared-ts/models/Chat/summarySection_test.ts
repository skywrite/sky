import type { ModelProfile } from '#shared/ai/models.ts'
import { assert, test } from '#test'
import { cleanSummaryText, summaryModel, summaryPrompt, writeChatSummary } from './summarySection.ts'

test('summaryModel - High where the model offers it, named without the vendor', () => {
  const opus: ModelProfile = {
    provider: 'anthropic',
    model: 'claude-opus-5-5',
    options: { effort: 'xhigh', thinking: { type: 'adaptive' } },
  }
  const sol: ModelProfile = { provider: 'openai', model: 'gpt-6.1-sol' }
  const local: ModelProfile = { provider: 'ollama', model: 'qwen3' }
  assert({
    given: 'an Opus 5.5 preset at X-high, a GPT 6.1 Sol preset, and a local model with no effort levels',
    should: 'run the first two at High and say so, and run the local model as its preset, named alone',
    actual: [summaryModel(opus), summaryModel(sol), summaryModel(local)],
    expected: [
      { effort: 'high', by: 'Opus 5.5, High' },
      { effort: 'high', by: 'GPT 6.1 Sol, High' },
      { effort: 'default', by: 'Qwen3' },
    ],
  })
})

test('cleanSummaryText - heading lines go, so the section cannot end early', () => {
  assert({
    given: 'a reply that opens with its own heading and carries a Conversation heading',
    should: 'keep only the prose',
    actual: cleanSummaryText('## Summary\n\nJane asked about Atlas.\n\n## Conversation\nSky answered.\n'),
    expected: 'Jane asked about Atlas.\n\nSky answered.',
  })

  assert({
    given: 'a bulleted reply',
    should: 'keep every bullet',
    actual: cleanSummaryText('- Sky drafted the Atlas plan.\n- Jane chose a May launch.\n'),
    expected: '- Sky drafted the Atlas plan.\n- Jane chose a May launch.',
  })

  assert({
    given: 'a reply of headings only',
    should: 'leave nothing to write',
    actual: cleanSummaryText('# Summary\n\n'),
    expected: undefined,
  })
})

test('summaryPrompt - names the speakers, and reads a branch opening as context only', () => {
  const own = summaryPrompt({ transcript: 'Jane: Plan the Atlas launch.', userLabel: 'Jane' })
  const branch = summaryPrompt({
    transcript: 'Jane: Now the board pack.',
    earlier: 'Jane: Help with the week.',
    userLabel: 'Jane',
  })
  assert({
    given: 'a chat of its own and a branch with an inherited opening',
    should: 'name Jane and Sky, and put the earlier conversation before the transcript for the branch only',
    actual: {
      names: own.includes('between Jane and Sky'),
      ownEarlier: own.includes('<earlier>'),
      branchEarlierFirst: branch.includes('<earlier>') && branch.indexOf('<earlier>') < branch.indexOf('<transcript>'),
    },
    expected: { names: true, ownEarlier: false, branchEarlierFirst: true },
  })
})

test('writeChatSummary - nothing said, nothing to summarize', async () => {
  assert({
    given: 'a conversation with no text in it',
    should: 'abstain without calling a model',
    actual: await writeChatSummary({ turns: [{ role: 'user', content: '<!-- pasted -->' }], userLabel: 'Jane' }),
    expected: undefined,
  })
})
