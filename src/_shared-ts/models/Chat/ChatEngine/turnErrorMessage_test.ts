import { APICallError, RetryError } from 'ai'
import { assert, test } from '#test'
import { apiErrorMessage, turnErrorMessage } from './turnErrorMessage.ts'

const call = (over: Partial<{ statusCode: number; responseBody: string; url: string; message: string }>) =>
  new APICallError({
    message: over.message ?? 'Bad Request',
    url: over.url ?? 'https://api.anthropic.com/v1/messages',
    requestBodyValues: {},
    statusCode: over.statusCode,
    responseBody: over.responseBody,
  })

test(
  { name: 'turnErrorMessage - an answer with no body names the host and the status, and says to send again' },
  async () => {
    assert({
      given: 'a 400 with an empty body, a 503 with a blank body, and one wrapped in a retry the SDK gave up on',
      should: 'say who answered what, and that sending again is the move',
      actual: [
        turnErrorMessage(call({ statusCode: 400, responseBody: '' })),
        turnErrorMessage(call({ statusCode: 503, responseBody: '  \n', message: 'Service Unavailable' })),
        turnErrorMessage(
          new RetryError({
            message: 'Failed after 3 attempts',
            reason: 'maxRetriesExceeded',
            errors: [call({ statusCode: 529, responseBody: '' })],
          }),
        ),
      ],
      expected: [
        'api.anthropic.com answered 400 with an empty body. Try sending it again.',
        'api.anthropic.com answered 503 with an empty body. Try sending it again.',
        'api.anthropic.com answered 529 with an empty body. Try sending it again.',
      ],
    })
  },
)

test({ name: "turnErrorMessage - a provider's own reason stands, and so does any other error" }, async () => {
  assert({
    given: 'a 400 whose body carried a reason, a call that never reached the API, and a plain error',
    should: 'keep each message as it was',
    actual: [
      turnErrorMessage(
        call({
          statusCode: 400,
          responseBody: '{"type":"error","error":{"message":"prompt is too long: 9 tokens > 8 maximum"}}',
          message: 'prompt is too long: 9 tokens > 8 maximum',
        }),
      ),
      turnErrorMessage(call({ message: 'Cannot connect to API: fetch failed' })),
      turnErrorMessage(new Error('boom')),
      turnErrorMessage('a string'),
    ],
    expected: ['prompt is too long: 9 tokens > 8 maximum', 'Cannot connect to API: fetch failed', 'boom', 'a string'],
  })
})

test({ name: 'turnErrorMessage - a reason the SDK did not read is quoted with the host and the status' }, async () => {
  const cerebras =
    '{"message":"Please reduce the length of the messages or completion. Current length is 196699 while limit is 131072",' +
    '"type":"invalid_request_error","param":"messages","code":"context_length_exceeded","id":""}'
  assert({
    given:
      "a Cerebras 400 whose reason sits at the body's top, an OpenAI-shaped 429 the SDK reduced to its status text, and a 400 whose body is an HTML page",
    should:
      'name the host and the status and quote the reason where there is one, and keep the SDK message where there is none',
    actual: [
      turnErrorMessage(
        call({ statusCode: 400, responseBody: cerebras, url: 'https://api.cerebras.ai/v1/chat/completions' }),
      ),
      turnErrorMessage(
        call({
          statusCode: 429,
          responseBody: '{"error":{"message":"Rate limit reached for qwen-3.8-27b","type":"rate_limit_error"}}',
          message: 'Too Many Requests',
          url: 'https://api.cerebras.ai/v1/chat/completions',
        }),
      ),
      turnErrorMessage(call({ statusCode: 400, responseBody: '<html><body>400 Bad Request</body></html>' })),
    ],
    expected: [
      'api.cerebras.ai answered 400: Please reduce the length of the messages or completion. Current length is 196699 while limit is 131072',
      'api.cerebras.ai answered 429: Rate limit reached for qwen-3.8-27b',
      'Bad Request',
    ],
  })
})

test({ name: 'apiErrorMessage - an answer from a model API names whose API failed' }, async () => {
  assert({
    given:
      'an Anthropic 503 the SDK retried and gave up on, a Cerebras 429 whose reason the SDK did not read, and an Anthropic 529 with an empty body',
    should: 'lead with the provider and the status, then the reason when there is one',
    actual: [
      apiErrorMessage(
        new RetryError({
          message: 'Failed after 3 attempts',
          reason: 'maxRetriesExceeded',
          errors: [
            call({
              statusCode: 503,
              responseBody:
                '{"type":"error","error":{"type":"api_error","message":"Grammar compilation is temporarily unavailable. Please try again."}}',
              message: 'Grammar compilation is temporarily unavailable. Please try again.',
            }),
          ],
        }),
      ),
      apiErrorMessage(
        call({
          statusCode: 429,
          responseBody: '{"message":"Rate limit reached for qwen-3.8-27b"}',
          message: 'Too Many Requests',
          url: 'https://api.cerebras.ai/v1/chat/completions',
        }),
      ),
      apiErrorMessage(call({ statusCode: 529, responseBody: '', message: '' })),
    ],
    expected: [
      'Anthropic API error (503): Grammar compilation is temporarily unavailable. Please try again.',
      'Cerebras API error (429): Rate limit reached for qwen-3.8-27b',
      'Anthropic API error (529)',
    ],
  })
})

test({ name: 'apiErrorMessage - anything that is not a named API answer keeps its own words' }, async () => {
  assert({
    given: 'a host Sky has no name for, a call that never reached the API, and a plain error',
    should: 'name an unknown host as itself and keep every other message as it was',
    actual: [
      apiErrorMessage(
        call({
          statusCode: 404,
          responseBody: '{"error":"model not found"}',
          url: 'http://localhost:11434/v1/chat/completions',
        }),
      ),
      apiErrorMessage(call({ message: 'Cannot connect to API: fetch failed' })),
      apiErrorMessage(new Error('Choose an available model configuration.')),
    ],
    expected: [
      'localhost:11434 API error (404): model not found',
      'Cannot connect to API: fetch failed',
      'Choose an available model configuration.',
    ],
  })
})
