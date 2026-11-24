import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import PeopleStore from '#shared/models/Store/PeopleStore/mod.ts'
import { assert, test } from '#test'
import { isAutomatedSender, isOwnerAuthor, isSenderEligible, resolveSender } from './sender.ts'

test('resolveSender matches by email/phone handle and name via PeopleStore and ScoringStore', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sky-nr-people-'))
  try {
    await writeFile(
      path.join(dir, 'Jane-Doe.md'),
      `---
name: Jane Doe
alt: JD
email: jane@example.com
phone: "+1-555-010-2020"
---
# Jane Doe
`,
    )
    const people = await PeopleStore.build([dir])
    const scores = new Map<string, number>([
      ['jane doe', 420],
      ['alex rivera', 85],
    ])
    const scoreLookup = (name: string) => scores.get(name.toLowerCase()) ?? 0
    const macContacts = {
      resolve: (handle: string) => {
        if (handle.toLowerCase() === 'pat@example.com') {
          return { name: 'Pat Kim', known: true, handles: ['pat@example.com'] }
        }
        return null
      },
      hasContactName: (name: string) => ['jane doe', 'pat kim', 'casey arden'].includes(name.toLowerCase()),
    }

    const byEmail = resolveSender({ name: 'J. Doe', email: 'jane@example.com' }, { people, scoreLookup, macContacts })
    const byPhone = resolveSender(
      { name: '+1 (555) 010-2020', phone: '+1 (555) 010-2020' },
      { people, scoreLookup, macContacts },
    )
    const byScoreOnly = resolveSender({ name: 'Alex Rivera' }, { people, scoreLookup, macContacts })
    const byMacContactName = resolveSender({ name: 'Casey Arden' }, { people, scoreLookup, macContacts })
    const byMacContactEmail = resolveSender(
      { name: 'Pat', email: 'pat@example.com' },
      { people, scoreLookup, macContacts },
    )
    const unknown = resolveSender(
      { name: '+1-555-999-8888', phone: '+1-555-999-8888' },
      { people, scoreLookup, macContacts },
    )

    assert({
      given:
        'known handles, a scored colleague, Mac Contacts matches without people profiles, and an unknown phone number',
      should: 'resolve canonical names/scores, flag Mac Contacts elevation, and mark unknown numbers unregistered',
      actual: { byEmail, byPhone, byScoreOnly, byMacContactName, byMacContactEmail, unknown },
      expected: {
        byEmail: { displayName: 'Jane Doe', personScore: 420, registered: true, inMacContacts: true },
        byPhone: { displayName: 'Jane Doe', personScore: 420, registered: true, inMacContacts: true },
        byScoreOnly: { displayName: 'Alex Rivera', personScore: 85, registered: true, inMacContacts: false },
        byMacContactName: { displayName: 'Casey Arden', personScore: 0, registered: true, inMacContacts: true },
        byMacContactEmail: { displayName: 'Pat Kim', personScore: 0, registered: true, inMacContacts: true },
        unknown: { displayName: '+1-555-999-8888', personScore: 0, registered: false, inMacContacts: false },
      },
    })

    assert({
      given: 'unregistered senders with and without prior participation, previous history, or resolved Beeper name',
      should: 'drop cold unknown senders while admitting engaged threads, prior history, and resolved Beeper contacts',
      actual: [
        isSenderEligible({ registered: false, ownerParticipated: false }),
        isSenderEligible({ registered: false, ownerParticipated: true }),
        isSenderEligible({ registered: false, ownerParticipated: false, hasPriorHistory: true }),
        isSenderEligible({ registered: false, ownerParticipated: false, resolvedBeeperName: true }),
        isSenderEligible({ registered: true, ownerParticipated: false }),
      ],
      expected: [false, true, true, true, true],
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('isAutomatedSender and isOwnerAuthor detect bots, bulk mail, and owner aliases', () => {
  assert({
    given: 'automated email addresses, bulk labels, and a real person',
    should: 'filter bots and bulk labels while keeping normal senders',
    actual: [
      isAutomatedSender({ email: 'no-reply@example.com' }),
      isAutomatedSender({ email: 'jane@example.com', labels: ['INBOX', 'CATEGORY_PROMOTIONS'] }),
      isAutomatedSender({ name: 'Slackbot' }),
      isAutomatedSender({ name: 'Jane Doe', email: 'jane@example.com', labels: ['INBOX'] }),
    ],
    expected: [true, true, true, false],
  })

  assert({
    given: 'owner display names and email addresses',
    should: 'match case-insensitively across full name, first name, and angle-bracketed addresses',
    actual: [
      isOwnerAuthor('Sam Owner', ['Sam Owner', 'Sam'], ['sam@example.com']),
      isOwnerAuthor('Sam <sam@example.com>', ['Sam Owner'], ['sam@example.com']),
      isOwnerAuthor('Jane Doe <jane@example.com>', ['Sam Owner', 'Sam'], ['sam@example.com']),
    ],
    expected: [true, true, false],
  })
})
