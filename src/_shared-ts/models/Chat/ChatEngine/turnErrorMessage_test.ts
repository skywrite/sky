import { APICallError, RetryError } from 'ai'
import { assert, test } from '#test'
import { apiErrorMessage } from './turnErrorMessage.ts'

const call = (over: Partial<{ statusCode: number; responseBody: string; url: string; message: string }>) =>
  new APICallError({
    message: over.message ?? 'Bad Request',
    url: over.url ?? 'https://api.anthropic.com/v1/messages',
    requestBodyValues: {},
    statusCode: over.statusCode,
    responseBody: over.responseBody,
  })

test(
  { name: 'apiErrorMessage - an answer from a model API names whose API failed, the status and the reason' },
  async () => {
    const cerebras =
      '{"message":"Please reduce the length of the messages or completion. Current length is 196699 while limit is 131072",' +
      '"type":"invalid_request_error","param":"messages","code":"context_length_exceeded","id":""}'
    assert({
      given:
        'an Anthropic 503 the SDK retried and gave up on, an Anthropic 400 whose reason the SDK read, a Cerebras 400 and an OpenAI-shaped 429 whose reasons it did not, a 400 whose body is an HTML page, and a 500 that says nothing in its body',
      should:
        "lead with the provider and the status, then the provider's own reason, or the SDK's message where the body gives none",
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
            statusCode: 400,
            responseBody: '{"type":"error","error":{"message":"prompt is too long: 9 tokens > 8 maximum"}}',
            message: 'prompt is too long: 9 tokens > 8 maximum',
          }),
        ),
        apiErrorMessage(
          call({ statusCode: 400, responseBody: cerebras, url: 'https://api.cerebras.ai/v1/chat/completions' }),
        ),
        apiErrorMessage(
          call({
            statusCode: 429,
            responseBody: '{"error":{"message":"Rate limit reached for qwen-3.8-27b","type":"rate_limit_error"}}',
            message: 'Too Many Requests',
            url: 'https://api.cerebras.ai/v1/chat/completions',
          }),
        ),
        apiErrorMessage(call({ statusCode: 400, responseBody: '<html><body>400 Bad Request</body></html>' })),
        apiErrorMessage(call({ statusCode: 500, responseBody: '{}', message: '' })),
      ],
      expected: [
        'Anthropic API error (503): Grammar compilation is temporarily unavailable. Please try again.',
        'Anthropic API error (400): prompt is too long: 9 tokens > 8 maximum',
        'Cerebras API error (400): Please reduce the length of the messages or completion. Current length is 196699 while limit is 131072',
        'Cerebras API error (429): Rate limit reached for qwen-3.8-27b',
        'Anthropic API error (400): Bad Request',
        'Anthropic API error (500)',
      ],
    })
  },
)

test(
  { name: 'apiErrorMessage - an answer with no body names the provider and the status, and says to try again' },
  async () => {
    assert({
      given: 'a 400 with an empty body, a 503 with a blank body, and one wrapped in a retry the SDK gave up on',
      should: 'say whose API answered what, and that trying again is the move',
      actual: [
        apiErrorMessage(call({ statusCode: 400, responseBody: '' })),
        apiErrorMessage(call({ statusCode: 503, responseBody: '  \n', message: 'Service Unavailable' })),
        apiErrorMessage(
          new RetryError({
            message: 'Failed after 3 attempts',
            reason: 'maxRetriesExceeded',
            errors: [call({ statusCode: 529, responseBody: '' })],
          }),
        ),
      ],
      expected: [
        'Anthropic API error (400): no reason given. Try again.',
        'Anthropic API error (503): no reason given. Try again.',
        'Anthropic API error (529): no reason given. Try again.',
      ],
    })
  },
)

test({ name: 'apiErrorMessage - anything that is not a named API answer keeps its own words' }, async () => {
  assert({
    given: 'a host Sky has no name for, a call that never reached the API, a plain error, and a string',
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
      apiErrorMessage(new Error('boom')),
      apiErrorMessage('a string'),
    ],
    expected: [
      'localhost:11434 API error (404): model not found',
      'Cannot connect to API: fetch failed',
      'boom',
      'a string',
    ],
  })
})
