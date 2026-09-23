import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { assert, test } from '#test'
import { ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { createTestHttpApp } from '../httpTestHelpers.ts'
import { createPeopleStore } from './store.ts'
import { blankProfile, profileHref, type PeopleOptions, type ProfileDetail } from './types.ts'

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-people-test-'))
  const peopleDir = path.join(root, 'people')
  const orgsDir = path.join(root, 'orgs')
  const timeDir = path.join(root, 'time')
  const dirs = [peopleDir, orgsDir, timeDir]
  await Promise.all(dirs.map((dir) => mkdir(dir)))
  const store = await MarkdownStore.build({ peopleDirs: [peopleDir], orgDirs: [orgsDir], timeDirs: [timeDir] })
  const options: PeopleOptions = {
    peopleDir,
    orgsDir,
    stateDir: path.join(root, '.state'),
    now: () => new ZonedDateTime('2026-02-12 09:34', 'America/Chicago'),
  }
  const profiles = createPeopleStore(store, root, dirs, options)
  const seed = async (file: string, raw: string) => {
    const target = path.join(root, file)
    await writeFile(target, raw)
    store.set(target, raw)
  }
  return {
    root,
    store,
    options,
    profiles,
    seed,
    app: createTestHttpApp(dirs, { markdownStore: store, people: options }),
    close: () => rm(root, { recursive: true, force: true }),
  }
}

test('People save into notebook stores, link current and past organizations, and retain comments and unknown metadata', async () => {
  const f = await fixture()
  try {
    await f.seed(
      'orgs/Atlas.md',
      '---\nname: Atlas\nsites: [https://www.linkedin.com/company/atlas-example/]\ntags: Organization/Company/Research\n---\n# Atlas\n',
    )
    const saved = await f.profiles.save({
      ...blankProfile('person'),
      name: 'Jane Doe',
      title: 'Designer',
      current: [{ name: 'Atlas Studio', linkedin: 'https://www.linkedin.com/company/atlas-example/' }],
      past: [{ name: 'Cedar Foundation' }],
      notes: 'Met at the design workshop.',
    })
    const raw = await readFile(path.join(f.root, saved.id), 'utf8')
    const org = await f.profiles.detail('org', 'orgs/Atlas.md')
    assert({
      given: 'a reviewed draft with one known and one new organization',
      should: 'publish readable files and relationships that both pages resolve',
      actual: {
        id: saved.id,
        orgs: (await f.profiles.index()).orgs.length,
        current: saved.current,
        past: saved.past.map((item) => item.name),
        people: org.people.map((item) => item.name),
        indexed: f.store.people.size,
        notes: raw.includes('Met at the design workshop.'),
      },
      expected: {
        id: 'people/2026/2026-02-12_093400_Jane-Doe.md',
        orgs: 2,
        current: [{ name: 'Atlas', id: 'orgs/Atlas.md', slug: 'atlas', linkedin: undefined }],
        past: ['Cedar Foundation'],
        people: ['Jane Doe'],
        indexed: 1,
        notes: true,
      },
    })

    const original =
      '---\n# Keep this comment\nname: [Sam Rivera, Sam]\nemail:\n  business: [sam@example.com, rivera@example.com]\n  assistant: assistant@example.com\norg: Atlas\ncustom:\n  nested: preserve this\ncreated: 2024-01-01\n---\n\n# Sam Rivera\n\nA hand-written paragraph.\n\n## History\n\nKeep every line.\n'
    await f.seed('people/Sam.md', original)
    const before = await f.profiles.detail('person', 'people/Sam.md')
    const after = await f.profiles.save({ ...before, title: 'Research lead' })
    const edited = await readFile(path.join(f.root, after.id), 'utf8')
    assert({
      given: 'a metadata edit to an established profile',
      should: 'preserve comments, extra fields, creation date, multiple emails, and the exact body',
      actual: [
        edited.includes('# Keep this comment'),
        edited.includes('assistant: assistant@example.com'),
        edited.includes('nested: preserve this'),
        edited.includes('created: 2024-01-01'),
        edited.endsWith(original.split('---\n').at(-1)!),
        after.emailBusiness,
        after.current[0].name,
      ],
      expected: [true, true, true, true, true, ['sam@example.com', 'rivera@example.com'], 'Atlas'],
    })
    const changed = await f.profiles.save({ ...after, name: 'Samuel Rivera' })
    assert({
      given: 'a renamed person',
      should: 'keep the stable path and former name',
      actual: [changed.id, changed.aliases.includes('Sam Rivera'), profileHref(changed)],
      expected: ['people/Sam.md', true, '/people/sam-rivera'],
    })
  } finally {
    await f.close()
  }
})

test('Duplicate imports, ambiguous organizations, concurrent namesakes, and stale edits cannot silently overwrite records', async () => {
  const f = await fixture()
  try {
    const input = {
      ...blankProfile('person'),
      name: 'Jane Doe',
      sites: ['https://www.linkedin.com/in/jane-doe-example/'],
    }
    const concurrent = await Promise.allSettled([f.profiles.save(input), f.profiles.save(input)])
    assert({
      given: 'two simultaneous saves of the same imported profile',
      should: 'create one person and reject the duplicate',
      actual: concurrent.map((result) => result.status).sort(),
      expected: ['fulfilled', 'rejected'],
    })
    const first = (await f.profiles.index()).people[0]
    const second = await f.profiles.save({ ...blankProfile('person'), name: 'Jane Doe', allowNamesake: true })
    assert({
      given: 'two distinct people with the same name',
      should: 'retain both and atomically suffix the second filename',
      actual: [(await f.profiles.index()).people.length, second.id, profileHref(first), profileHref(second)],
      expected: [2, 'people/2026/2026-02-12_093400_Jane-Doe-2.md', '/people/jane-doe', '/people/jane-doe-2'],
    })
    const before = await f.profiles.detail('person', first.id)
    await f.seed(first.id, (await readFile(path.join(f.root, first.id), 'utf8')) + '\nAn external edit.\n')
    let stale = ''
    try {
      await f.profiles.save({ ...before, title: 'New title' })
    } catch (error) {
      stale = (error as Error).message
    }
    assert({
      given: 'an external edit after opening the form',
      should: 'refuse the stale save and retain the external text',
      actual: [
        stale.includes('changed'),
        (await readFile(path.join(f.root, first.id), 'utf8')).includes('An external edit.'),
      ],
      expected: [true, true],
    })
    await f.seed('orgs/first.md', '---\nname: Atlas\n---\nFirst organization.\n')
    await f.seed('orgs/second.md', '---\nname: Atlas\n---\nSecond organization.\n')
    let ambiguous = ''
    try {
      await f.profiles.save({ ...blankProfile('person'), name: 'Alex Reed', current: [{ name: 'Atlas' }] })
    } catch (error) {
      ambiguous = (error as Error).message
    }
    const picked = await f.profiles.save({
      ...blankProfile('person'),
      name: 'Alex Reed',
      current: [{ name: 'Atlas', id: 'orgs/second.md' }],
    })
    assert({
      given: 'organizations sharing a name',
      should: 'require a choice and retain that exact relationship after serialization',
      actual: [
        ambiguous.includes('More than one'),
        picked.current[0].id,
        (await f.profiles.detail('org', 'orgs/first.md')).people.length,
        (await f.profiles.detail('org', 'orgs/second.md')).people.length,
      ],
      expected: [true, 'orgs/second.md', 0, 1],
    })
  } finally {
    await f.close()
  }
})

test('Different LinkedIn company identities sharing a name require an explicit link or creation choice', async () => {
  const f = await fixture()
  try {
    await f.seed(
      'orgs/Atlas.md',
      '---\nname: Atlas\nsites: [https://www.linkedin.com/company/atlas-old-example/]\n---\n',
    )
    const input = {
      ...blankProfile('person'),
      name: 'Taylor Reed',
      current: [{ name: 'Atlas', linkedin: 'https://www.linkedin.com/company/atlas-new-example/' }],
    }
    let refused = false
    try {
      await f.profiles.save(input)
    } catch {
      refused = true
    }
    assert({
      given: 'a known company name but a different LinkedIn company identity',
      should: 'leave the notebook untouched until the user chooses',
      actual: [refused, f.store.people.size, f.store.orgs.size],
      expected: [true, 0, 1],
    })
    const saved = await f.profiles.save({ ...input, current: input.current.map((org) => ({ ...org, create: true })) })
    const linked = await f.profiles.detail('org', saved.current[0].id!)
    assert({
      given: 'an explicit choice to create the separate organization',
      should: 'retain both namesakes and link the intended company',
      actual: [f.store.orgs.size, linked.sites, (await f.profiles.detail('org', 'orgs/Atlas.md')).people.length],
      expected: [2, ['https://www.linkedin.com/company/atlas-new-example/'], 0],
    })
  } finally {
    await f.close()
  }
})

test('Profile HTTP routes serve real URLs, validate writes, append notes, and keep file access inside regular notebook files', async () => {
  const f = await fixture()
  try {
    const post = (route: string, body: unknown, origin?: string) =>
      f.app.request(`/people/_api${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
        body: JSON.stringify(body),
      })
    const forbidden = await post('/profile', { ...blankProfile('person'), name: 'Jane Doe' }, 'https://example.com')
    const invalid = await post('/profile', {
      ...blankProfile('person'),
      name: 'Jane Doe',
      sites: ['javascript:alert(1)'],
    })
    const response = await post('/profile', {
      ...blankProfile('person'),
      name: 'Jane Doe',
      notes: 'A first paragraph.\n\nA second paragraph.\n\n<script>alert(1)</script>\n\n[Bad](javascript:alert(1))',
    })
    const saved = (await response.json()) as ProfileDetail
    const note = await post('/note', { type: 'person', id: saved.id, revision: saved.revision, text: 'A later note.' })
    const annotated = (await note.json()) as ProfileDetail
    const old = await post('/note', { type: 'person', id: saved.id, revision: saved.revision, text: 'Stale note.' })
    const traversal = await f.app.request('/people/_api/profile?type=person&id=../../outside.md')
    const shell = await f.app.request(profileHref(saved))
    const legacy = await f.app.request(`/people/${saved.id}?from=bookmark`)
    const extensionless = await f.app.request(`/people/${saved.id.slice(0, -3)}`)
    const bySlug = await f.app.request(`/people/_api/profile?type=person&slug=${saved.slug}`)
    assert({
      given: 'clean routes and bookmarks using the previous file paths',
      should: 'resolve the same profile and redirect old links without exposing notebook folders',
      actual: [
        shell.status,
        legacy.status,
        legacy.headers.get('location'),
        extensionless.headers.get('location'),
        ((await bySlug.json()) as ProfileDetail).id,
      ],
      expected: [200, 308, '/people/jane-doe?from=bookmark', '/people/jane-doe', saved.id],
    })
    const unknown = await f.app.request('/people/_api/missing')
    await f.seed('people/link.md', '---\nname: Alias\n---\n')
    await rm(path.join(f.root, 'people/link.md'))
    await symlink(path.join(f.root, saved.id), path.join(f.root, 'people/link.md'))
    const symlinked = await f.app.request('/people/_api/profile?type=person&id=people/link.md')
    assert({
      given: 'real HTTP saves, stale notes, unknown API paths, cross-site requests and symlinks',
      should: 'serve the page, save safely, and reject invalid access',
      actual: [
        forbidden.status,
        invalid.status,
        response.status,
        note.status,
        old.status,
        traversal.status,
        shell.headers.get('content-type')?.includes('text/html'),
        unknown.status,
        symlinked.status,
        annotated.html.includes('A later note.'),
        saved.html.includes('<script'),
        saved.html.includes('javascript:'),
      ],
      expected: [403, 400, 200, 200, 409, 404, true, 404, 403, true, false, false],
    })
  } finally {
    await f.close()
  }
})

test('Profile URLs survive name edits, file moves and a new store, without reusing removed namesakes', async () => {
  const f = await fixture()
  try {
    const first = await f.profiles.save({ ...blankProfile('person'), name: 'Jane Doe', notes: 'First person.' })
    const second = await f.profiles.save({
      ...blankProfile('person'),
      name: 'Jane Doe',
      notes: 'Second person.',
      allowNamesake: true,
    })
    const org = await f.profiles.save({ ...blankProfile('org'), name: 'Atlas' })
    const otherOrg = await f.profiles.save({ ...blankProfile('org'), name: 'Atlas', allowNamesake: true })
    const changed = await f.profiles.save({ ...second, name: 'Jane Rivera' })
    const destination = path.join(f.options.peopleDir, 'Moved.md')
    await rename(path.join(f.root, changed.id), destination)
    f.store.delete(path.join(f.root, changed.id))
    f.store.set(destination, await readFile(destination, 'utf8'))
    const restarted = createPeopleStore(f.store, f.root, [f.options.peopleDir, f.options.orgsDir], f.options)
    const moved = await restarted.resolveRoute('person', second.slug)
    await rm(path.join(f.root, first.id))
    f.store.delete(path.join(f.root, first.id))
    const third = await restarted.save({
      ...blankProfile('person'),
      name: 'Jane Doe',
      notes: 'Third person.',
      allowNamesake: true,
    })
    assert({
      given: 'namesakes, a renamed and moved profile, a service restart and a deleted name',
      should: 'keep existing public URLs and reserve the removed URL instead of linking it to someone else',
      actual: [
        profileHref(changed),
        moved?.id,
        moved?.name,
        profileHref(third),
        await restarted.resolveRoute('person', first.slug),
        profileHref(org),
        profileHref(otherOrg),
      ],
      expected: [
        '/people/jane-doe-2',
        'people/Moved.md',
        'Jane Rivera',
        '/people/jane-doe-3',
        undefined,
        '/orgs/atlas',
        '/orgs/atlas-2',
      ],
    })
    const oldOrg = await f.app.request(`/orgs/${org.id}`)
    assert({
      given: 'an organization bookmark containing a file path and extension',
      should: 'redirect to the clean organization route',
      actual: [oldOrg.status, oldOrg.headers.get('location')],
      expected: [308, '/orgs/atlas'],
    })
  } finally {
    await f.close()
  }
})
