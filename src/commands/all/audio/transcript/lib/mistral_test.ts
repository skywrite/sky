import { spyOn } from 'bun:test'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { transcribeWithMistral } from './mistral.ts'

test('Mistral preserves speaker labels and forwards cancellation to the upload', async () => {
  const getEnv = spyOn(env, 'get').mockReturnValue('mock-api-key')
  const requests: RequestInit[] = []
  const upload = spyOn(globalThis, 'fetch').mockImplementation((async (_url, init) => {
    requests.push(init!)
    return Response.json({
      text: 'Hello. Welcome.',
      segments: [
        { speaker: 'speaker_1', text: 'Hello.' },
        { speaker: 'speaker_2', text: 'Welcome.' },
      ],
    })
  }) as typeof fetch)
  try {
    const signal = new AbortController().signal
    const result = await transcribeWithMistral(new Uint8Array([1]), 'sample.wav', { diarize: true, signal })
    const form = requests[0].body as FormData
    assert({
      given: 'a recording with speaker diarization requested',
      should: 'upload with the expected model, retain labels, and pass the signal',
      actual: [
        form.get('model'),
        form.get('diarize'),
        (form.get('file') as File).type,
        requests[0].signal === signal,
        result.text,
      ],
      expected: [
        'voxtral-mini-latest',
        'true',
        'audio/wav',
        true,
        '**speaker_1:**\nHello.\n\n**speaker_2:**\nWelcome.',
      ],
    })
  } finally {
    getEnv.mockRestore()
    upload.mockRestore()
  }
})
