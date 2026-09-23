import { assert, test } from '#test'
import { derivedProjectId, pairFromClientJson } from './consoleSteps.ts'

test('the project id is read off the form’s own line, whatever shape the console gave it', () => {
  assert({
    given: 'the strong texts on the New Project form',
    should: 'read the id and drop its full stop; ignore the other strong words; give nothing when the line is missing',
    expected: ['sky-atlas-104827', 'brave-otter-104826-k3', undefined],
    actual: [
      derivedProjectId(['sky-atlas-104827.', 'cannot be changed later.']),
      derivedProjectId(['cannot be changed later.', 'brave-otter-104826-k3.']),
      derivedProjectId(['cannot be changed later.', 'Sky Notebook']),
    ],
  })
})

test('the client pair is read out of the JSON Google offers', () => {
  assert({
    given: 'the installed-app JSON, the web-app JSON, and something else',
    should: 'give the pair from either, and nothing otherwise',
    expected: [
      { clientId: 'id-1.apps.googleusercontent.com', clientSecret: 'GOCSPX-abc' },
      { clientId: 'id-2.apps.googleusercontent.com', clientSecret: 'GOCSPX-def' },
      null,
      null,
    ],
    actual: [
      pairFromClientJson('{"installed":{"client_id":"id-1.apps.googleusercontent.com","client_secret":"GOCSPX-abc"}}'),
      pairFromClientJson('{"web":{"client_id":"id-2.apps.googleusercontent.com","client_secret":"GOCSPX-def"}}'),
      pairFromClientJson('{"installed":{"client_id":"id-3"}}'),
      pairFromClientJson('not json'),
    ],
  })
})
