import type { LanguageModelV4FilePart, LanguageModelV4Prompt } from '@ai-sdk/provider'
import { assert, test } from '#test'
import { AttachmentContext } from './attachmentContext.ts'

const file = (name: string, bytes = 3000): LanguageModelV4FilePart => ({
  type: 'file',
  filename: name,
  mediaType: 'application/pdf',
  data: { type: 'data', data: new Uint8Array(bytes) },
  providerOptions: { sky: { sourcePath: `/mock/Downloaded/${name}`, attachmentPath: `/mock/Archive/${name}` } },
})

test('old native attachments become reopenable references, preserving findings, receipts and original bytes', () => {
  const first = file('Atlas.pdf')
  const latest = file('New.pdf')
  const prompt: LanguageModelV4Prompt = [
    { role: 'user', content: [{ type: 'text', text: 'Keep the originals.' }, first] },
    {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Atlas: invoice total is 42; page 2.' },
        { type: 'tool-call', toolName: 'read_file', toolCallId: 'next', input: { path: '/mock/New.pdf' } },
      ],
    },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolName: 'read_file',
          toolCallId: 'next',
          output: { type: 'content', value: [latest] },
        },
      ],
    },
  ]
  const original = structuredClone(prompt)
  const result = new AttachmentContext().prepare(prompt)
  const text = JSON.stringify(result.prompt)
  assert({
    given: 'an earlier uploaded PDF and a newly read PDF after an action',
    should: 'keep findings, exact tool pairs and the new PDF, reopen the archived original, and leave history intact',
    actual: {
      referenced: result.referenced,
      source: text.includes('/mock/Archive/Atlas.pdf'),
      findings: text.includes('invoice total is 42; page 2.'),
      instructions: text.includes('Keep the originals.'),
      latest: result.prompt[2],
      original: prompt,
    },
    expected: { referenced: 1, source: true, findings: true, instructions: true, latest: prompt[2], original },
  })
})

test('a legacy recovery reference never claims a deferred or failed read was inspected', () => {
  const old = file('Atlas.pdf')
  delete old.providerOptions
  const unnamed = { ...old, filename: undefined }
  const prompt: LanguageModelV4Prompt = [
    { role: 'user', content: [{ type: 'text', text: 'File: /mock/Atlas.pdf\nAttachment: Atlas.pdf' }, old] },
    { role: 'assistant', content: [{ type: 'text', text: 'The request failed before inspection.' }] },
    { role: 'user', content: [{ type: 'text', text: 'Compare this too.' }, unnamed] },
  ]
  const result = new AttachmentContext().prepare(prompt)
  assert({
    given: 'old metadata-free history with a source header and a file without any reopenable path',
    should: 'support recovery without implying inspection, and keep the irreplaceable bytes',
    actual: [
      result.referenced,
      JSON.stringify(result.prompt).includes('not evidence of inspection'),
      JSON.stringify(result.prompt).includes('/mock/Atlas.pdf'),
      result.prompt.at(-1),
    ],
    expected: [1, true, true, prompt.at(-1)],
  })
})

test('oversized fresh batches defer files explicitly, retain the newest, and can reopen a deferred file', () => {
  const prompt: LanguageModelV4Prompt = [
    { role: 'user', content: [file('First.pdf'), file('Second.pdf'), file('Third.pdf')] },
  ]
  const working = new AttachmentContext()
  const changed = working.reduce(prompt, 5000)
  const prepared = working.prepare(prompt)
  const secondPrompt: LanguageModelV4Prompt = [
    ...prompt,
    {
      role: 'assistant',
      content: [{ type: 'text', text: 'Third.pdf has been inspected. The other two are pending.' }],
    },
    { role: 'user', content: [file('First.pdf')] },
  ]
  const next = working.prepare(secondPrompt)
  assert({
    given: 'three new files exceeding one request, followed by a fresh read of the first file',
    should: 'defer two without claiming inspection, preserve the newest and accept the reread',
    actual: {
      changed,
      deferred: prepared.deferred,
      pending: JSON.stringify(prepared.prompt).includes('This file still needs inspection'),
      files: working.remaining(prepared.prompt),
      reread: working.remaining(next.prompt),
      nothingToReduce: working.reduce(next.prompt, 100000),
    },
    expected: {
      changed: true,
      deferred: 2,
      pending: true,
      files: ['Third.pdf'],
      reread: ['First.pdf'],
      nothingToReduce: false,
    },
  })
})

test('pending inspection survives recovery and is cleared only by a subsequent read of the same contents', () => {
  const first = file('First.pdf')
  const second = file('Second.pdf')
  const state: { deferredAttachments?: string[] } = {}
  const working = new AttachmentContext(state)
  const prompt: LanguageModelV4Prompt = [{ role: 'user', content: [first, second] }]
  working.reduce(prompt, 1)
  const restored = new AttachmentContext(JSON.parse(JSON.stringify(state)))
  const after: LanguageModelV4Prompt = [
    ...prompt,
    { role: 'assistant', content: [{ type: 'text', text: 'Second was inspected.' }] },
  ]
  const different: LanguageModelV4Prompt = [
    ...after,
    { role: 'user', content: [file('First.pdf', 6000)] },
    { role: 'assistant', content: [{ type: 'text', text: 'This is a different version.' }] },
  ]
  const same: LanguageModelV4Prompt = [
    ...after,
    { role: 'user', content: [first] },
    { role: 'assistant', content: [{ type: 'text', text: 'First was also inspected.' }] },
  ]
  assert({
    given: 'an unfinished attachment batch restored after restart, and later reads of changed or identical contents',
    should: 'retain the pending state until the same document has been available in a subsequent model step',
    actual: [restored.prepare(after).deferred, restored.prepare(different).deferred, restored.prepare(same).deferred],
    expected: [1, 1, 0],
  })
})
