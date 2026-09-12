import { assert, test } from '#test'
import { identifyAgentSlackFiles } from './files.ts'

test('agent-slack file identity compatibility stays at the wire boundary', () => {
  assert({
    given: 'provider IDs, current download names, an error receipt, and an arbitrary filename',
    should: 'preserve or recover only documented provider identities',
    actual: identifyAgentSlackFiles([
      { id: 'F0SOURCE', path: '/tmp/arbitrary.pdf' },
      { path: '/tmp/slack-downloads/F0ATLAS.pdf' },
      { path: '/tmp/slack-downloads/F0FAILED.download-error.txt', error: 'Unavailable' },
      { path: '/tmp/photo.png' },
    ])?.map((file) => file.id),
    expected: ['F0SOURCE', 'F0ATLAS', 'F0FAILED', undefined],
  })
})
