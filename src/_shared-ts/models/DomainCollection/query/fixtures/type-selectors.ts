/**
 * Type selector fixtures: meeting, person, message, etc.
 */

export default [
  {
    selector: 'meeting',
    expected: 'query { meetings { path markdown } }',
    description: 'all meetings',
  },
  {
    selector: 'person',
    expected: 'query { people { path markdown } }',
    description: 'all people',
  },
  {
    selector: 'message',
    expected: 'query { messages { path markdown } }',
    description: 'all messages',
  },
  {
    selector: 'decision',
    expected: 'query { decisions { path markdown } }',
    description: 'all decisions',
  },
  {
    selector: 'project',
    expected: 'query { projects { path markdown } }',
    description: 'all projects',
  },
  {
    selector: 'org',
    expected: 'query { orgs { path markdown } }',
    description: 'all organizations',
  },
  {
    selector: 'day',
    expected: 'query { days { path markdown } }',
    description: 'all days',
  },
  {
    selector: '*',
    expected: 'query { documents { path markdown } }',
    description: 'all documents (wildcard)',
  },
]
