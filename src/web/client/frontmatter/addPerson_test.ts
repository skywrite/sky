import { spyOn } from 'bun:test'
import { assert, test } from '#test'
import { addPerson, AddPersonError, canAddPerson } from './addPerson.ts'
import { resolveNames } from './complete.ts'

/** The service answering every request one way, and what it was asked. */
function answering(status: number, body: unknown) {
  const asked: Array<{ url: string; body: unknown }> = []
  const fetch = spyOn(globalThis, 'fetch').mockImplementation((async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    asked.push({ url: String(input), body: JSON.parse(String(init?.body ?? 'null')) })
    return Response.json(body, { status })
  }) as typeof globalThis.fetch)
  return { asked, restore: () => fetch.mockRestore() }
}

test({ name: 'add person - a name can be added, an address cannot' }, () => {
  assert({
    given: 'a full name, a first name, an address, a name with an address, and blanks',
    should: 'offer to add the names alone',
    actual: ['Jane Doe', 'Jane', 'jane@example.com', 'Jane Doe <jane@example.com>', '  '].map(canAddPerson),
    expected: [true, true, false, false, false],
  })
})

test(
  { name: 'add person - one request makes the person from the name alone, and the name points at the file' },
  async () => {
    const service = answering(200, { id: 'people/2026/ja/Jane-Doe.md' })
    try {
      const added = await addPerson('Jane Doe')
      const asked = service.asked.splice(0)
      // Asked again within the moment an answer stands: the panel already knows, and asks no one.
      const again = await resolveNames(['Jane Doe'], 'time/2026/W32/08-05/meetings/10-15_Atlas-sync.md')
      assert({
        given: 'a name the notebook has no profile for',
        should:
          'save a person holding only the name, answer the new file, and resolve the name to it without asking again',
        actual: { asked, added, again, askedAgain: service.asked.length },
        expected: {
          asked: [
            {
              url: '/people/_api/profile',
              body: {
                type: 'person',
                name: 'Jane Doe',
                aliases: [],
                title: '',
                location: '',
                emailPersonal: [],
                emailBusiness: [],
                sites: [],
                met: '',
                current: [],
                past: [],
                kind: 'unknown',
                sector: '',
              },
            },
          ],
          added: { type: 'person', path: 'people/2026/ja/Jane-Doe.md' },
          again: { 'Jane Doe': { type: 'person', path: 'people/2026/ja/Jane-Doe.md' } },
          askedAgain: 0,
        },
      })
    } finally {
      service.restore()
    }
  },
)

test({ name: 'add person - a refusal says why, and a name already in People says so' }, async () => {
  const outcome = async (status: number, body: unknown) => {
    const service = answering(status, body)
    try {
      await addPerson('Sam Rivera')
      return 'added'
    } catch (error) {
      return error instanceof AddPersonError ? { text: error.message, exists: error.exists } : String(error)
    } finally {
      service.restore()
    }
  }
  assert({
    given: 'a save refused for a namesake, and one refused while the notebook loads',
    should: 'say the name is already in People for the first, and pass the service’s reason on for the second',
    actual: [
      await outcome(409, { message: 'A profile with this name already exists.' }),
      await outcome(503, { message: 'Your notebook is still loading. Try again in a moment.' }),
    ],
    expected: [
      { text: 'A profile with that name is already in People.', exists: true },
      { text: 'Your notebook is still loading. Try again in a moment.', exists: false },
    ],
  })
})
