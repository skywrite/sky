import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import Automation from './mod.ts'

const CHARTER = `---
run: google:email:inbox:fetch
every: 5m
args:
  label: Sky/Follow
  limit: 5
status: active
---

# Keep followed mail current

## Why this matters

So the day summary and chat see mail without me opening Gmail.
`

function errorFor(contents: string): string {
  try {
    Automation.fromMarkdown(contents, 'test')
    return 'no error thrown'
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

test('Automation.fromMarkdown - reads the machine surface and keeps the brief', () => {
  const automation = Automation.fromMarkdown(CHARTER, 'email-fetch')

  assert({
    given: 'a charter with a command, an interval and args',
    should: 'expose each as typed fields',
    actual: {
      name: automation.name,
      run: automation.run,
      kind: automation.trigger.kind,
      intervalMs: automation.trigger.kind === 'every' ? automation.trigger.intervalMs : null,
      args: automation.args,
      status: automation.status,
    },
    expected: {
      name: 'email-fetch',
      run: 'google:email:inbox:fetch',
      kind: 'every',
      intervalMs: 300_000,
      args: { label: 'Sky/Follow', limit: 5 },
      status: 'active',
    },
  })

  assert({
    given: 'the prose under the frontmatter',
    should: 'be kept verbatim as the brief',
    actual: automation.brief.split('\n')[0],
    expected: '# Keep followed mail current',
  })
})

test('Automation.fromMarkdown - status defaults to active', () => {
  const automation = Automation.fromMarkdown('---\nrun: day:start\nat: 07:15\n---\n\nBrief.\n', 'day')

  assert({
    given: 'a charter with no status:',
    should: 'default to active',
    actual: [automation.status, automation.isRunnable(new PlainDate('2026-08-23'))],
    expected: ['active', true],
  })
})

test('Automation.fromMarkdown - rejects a charter it cannot act on', () => {
  const fixtures = [
    { label: 'no run:', contents: '---\nat: 07:15\n---\n', expects: 'run:' },
    { label: 'run: with flags inline', contents: '---\nrun: day:start --force\nat: 07:15\n---\n', expects: 'args:' },
    { label: 'empty run:', contents: '---\nrun: ""\nat: 07:15\n---\n', expects: 'run:' },
    { label: 'unknown status', contents: '---\nrun: day:start\nat: 07:15\nstatus: activ\n---\n', expects: 'status:' },
    { label: 'unreadable until', contents: '---\nrun: day:start\nat: 07:15\nuntil: someday\n---\n', expects: 'until:' },
    { label: 'args as a list', contents: '---\nrun: day:start\nat: 07:15\nargs:\n  - a\n---\n', expects: 'args:' },
    { label: 'no trigger', contents: '---\nrun: day:start\n---\n', expects: 'trigger' },
    { label: 'no frontmatter', contents: '# Just prose\n', expects: 'frontmatter' },
    { label: 'empty frontmatter', contents: '---\n---\n\nBrief.\n', expects: 'frontmatter' },
  ]

  fixtures.forEach((fixture) => {
    assert({
      given: fixture.label,
      should: `complain about ${fixture.expects}`,
      actual: errorFor(fixture.contents).includes(fixture.expects),
      expected: true,
    })
  })
})

test('Automation.fromMarkdown - collects unread keys instead of failing on them', () => {
  // `timezone:` is the dangerous one: it looks zoned but leaves the charter on
  // notebook time, so it has to be visible somewhere.
  const contents = '---\nrun: day:start\nat: 09:30\ntimezone: America/New_York\nowner: me\ncreated: 2026-08-23\n---\n'
  const automation = Automation.fromMarkdown(contents, 'typo')

  assert({
    given: 'frontmatter carrying a misspelled tz: and a document convention',
    should: 'flag only the keys the model does not read',
    actual: automation.unknownKeys,
    expected: ['timezone', 'owner'],
  })
})

test('Automation.isRunnable - paused and expired charters stand down', () => {
  const today = new PlainDate('2026-08-23')

  const fixtures = [
    { label: 'active, no expiry', yaml: 'status: active', expected: true },
    { label: 'paused', yaml: 'status: paused', expected: false },
    { label: 'expires today', yaml: 'until: 2026-08-23', expected: true },
    { label: 'expired yesterday', yaml: 'until: 2026-08-22', expected: false },
    { label: 'expires later', yaml: 'until: 2026-12-31', expected: true },
    { label: 'paused and unexpired', yaml: 'status: paused\nuntil: 2026-12-31', expected: false },
  ]

  fixtures.forEach((fixture) => {
    const automation = Automation.fromMarkdown(`---\nrun: day:start\nat: 07:15\n${fixture.yaml}\n---\n`, 'x')
    assert({
      given: fixture.label,
      should: fixture.expected ? 'be runnable' : 'not be runnable',
      actual: automation.isRunnable(today),
      expected: fixture.expected,
    })
  })
})
