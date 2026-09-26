import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import type { OrganizationRequest } from '#commands/all/org/lib/document.ts'
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
  const drafted: OrganizationRequest[] = []
  const options: PeopleOptions = {
    peopleDir,
    orgsDir,
    stateDir: path.join(root, '.state'),
    now: () => new ZonedDateTime('2026-02-12 09:34', 'America/Chicago'),
    // Stands in for org:new's website, Wikipedia and model lookup
    draftOrganization: async (request) => {
      drafted.push(request)
      return {
        name: request.name,
        sector: request.sector ?? 'research',
        subcategory: 'labs',
        kind: 'company',
        site: request.site,
        description: `${request.name} is an example organization.`,
      }
    },
  }
  const profiles = createPeopleStore(store, root, dirs, options)
  const seed = async (file: string, raw: string) => {
    const target = path.join(root, file)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, raw)
    store.set(target, raw)
  }
  return {
    root,
    store,
    options,
    profiles,
    seed,
    drafted,
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
        id: 'people/2026/ja/Jane-Doe.md',
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

test('New profiles are written as person:new and org:new write them, and edits never leave empty lists', async () => {
  const f = await fixture()
  try {
    const read = async (id: string) => readFile(path.join(f.root, id), 'utf8')
    const person = await f.profiles.save({ ...blankProfile('person'), name: 'Jane Doe' })
    const org = await f.profiles.save({
      ...blankProfile('org'),
      name: 'Cedar Foundation',
      sites: ['https://cedar.example/'],
      notes: 'Funds research.',
    })
    assert({
      given: 'a new person with only a name, and a new organization with a website and a note',
      should:
        "file the person by year and first letters with person:new's fields, and the organization by its looked-up category with one site and an overview",
      actual: [person.id, await read(person.id), org.id, await read(org.id), f.drafted],
      expected: [
        'people/2026/ja/Jane-Doe.md',
        '---\nname: Jane Doe\nlocation:\nemail:\n  personal:\n  business:\nsites:\ncreated: 2026-02-12\nupdated: 2026-02-12\nmet: 2026-02-12\ntags:\n---\n\n# Jane Doe\n\n## Background',
        'orgs/research/labs/Cedar-Foundation.md',
        '---\nname: Cedar Foundation\nslug: cedar-foundation\nsite: https://cedar.example/\nsector: research\nsubcategory: labs\nupdated: 2026-02-12\ncreated: 2026-02-12\ntags: Organization/Company\n---\n\n# Cedar Foundation\n\nFunds research.\n\n## Overview\n\nCedar Foundation is an example organization.\n\n\n## Misc',
        [{ name: 'Cedar Foundation', site: 'https://cedar.example/', sector: undefined }],
      ],
    })

    const sam = await f.profiles.save({
      ...blankProfile('person'),
      name: 'Sam Rivera',
      met: '2021',
      emailBusiness: ['sam@example.com'],
      current: [{ name: 'Cedar Foundation' }],
    })
    const withOrg = await read(sam.id)
    const cleared = await f.profiles.save({
      ...(await f.profiles.detail('person', sam.id)),
      emailBusiness: [],
      current: [],
    })
    const twoSites = await f.profiles.save({
      ...(await f.profiles.detail('org', org.id)),
      sites: ['https://cedar.example/', 'https://www.linkedin.com/company/cedar-example/'],
    })
    assert({
      given: 'a person whose organization and only email are later removed, and an organization given a second site',
      should:
        'drop the emptied fields instead of writing [], keep the blank line after the frontmatter, and list the sites where the site was',
      actual: [
        withOrg.includes('orgs:\n  current:\n    - Cedar Foundation\n') && !withOrg.includes('org_refs'),
        withOrg.includes('met: 2021\n'),
        await read(cleared.id),
        (await read(twoSites.id)).split('\n').slice(0, 7).join('\n'),
      ],
      expected: [
        true,
        true,
        '---\nname: Sam Rivera\nlocation:\nemail:\n  personal:\nsites:\ncreated: 2026-02-12\nupdated: 2026-02-12\nmet: 2021\ntags:\n---\n\n# Sam Rivera\n\n## Background',
        '---\nname: Cedar Foundation\nslug: cedar-foundation\nsites:\n  - https://cedar.example/\n  - https://www.linkedin.com/company/cedar-example/\nsector: research',
      ],
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
      expected: [2, 'people/2026/ja/Jane-Doe-2.md', '/people/jane-doe', '/people/jane-doe-2'],
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
    let picked = ''
    try {
      await f.profiles.save({
        ...blankProfile('person'),
        name: 'Alex Reed',
        current: [{ name: 'Atlas', id: 'orgs/second.md' }],
      })
    } catch (error) {
      picked = (error as Error).message
    }
    assert({
      given: 'organizations sharing a name',
      should: 'refuse to link either, even when one is chosen, since a name cannot say which',
      actual: [ambiguous, picked, f.store.people.getAll().toArray().length],
      expected: [
        'More than one organization is named Atlas. Give one of them a name of its own first.',
        'More than one organization is named Atlas. Give one of them a name of its own first.',
        2,
      ],
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
    let separate = ''
    try {
      await f.profiles.save({ ...input, current: input.current.map((org) => ({ ...org, create: true })) })
    } catch (error) {
      separate = (error as Error).message
    }
    const saved = await f.profiles.save({
      ...input,
      current: input.current.map((org) => ({ ...org, name: 'Atlas Labs', create: true })),
    })
    const linked = await f.profiles.detail('org', saved.current[0].id!)
    assert({
      given: 'a choice to create the separate organization, first under the same name, then under its own',
      should: 'refuse the same name, then create it and link the intended company',
      actual: [
        separate,
        f.store.orgs.size,
        linked.name,
        linked.sites,
        (await f.profiles.detail('org', 'orgs/Atlas.md')).people.length,
      ],
      expected: [
        'An organization named Atlas already exists. Choose it, or add the new one under a name of its own.',
        2,
        'Atlas Labs',
        ['https://www.linkedin.com/company/atlas-new-example/'],
        0,
      ],
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
    let otherOrg = ''
    try {
      await f.profiles.save({ ...blankProfile('org'), name: 'Atlas', allowNamesake: true })
    } catch (error) {
      otherOrg = (error as Error).message
    }
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
      given: 'namesakes, a renamed and moved profile, a service restart, a deleted name, and a second Atlas',
      should:
        'keep existing public URLs, reserve the removed URL instead of linking it to someone else, and refuse a second organization of the same name',
      actual: [
        profileHref(changed),
        moved?.id,
        moved?.name,
        profileHref(third),
        await restarted.resolveRoute('person', first.slug),
        profileHref(org),
        otherOrg,
      ],
      expected: [
        '/people/jane-doe-2',
        'people/Moved.md',
        'Jane Rivera',
        '/people/jane-doe-3',
        undefined,
        '/orgs/atlas',
        'An organization named Atlas already exists. Open it, or give this one a name of its own.',
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

test('Updating references renames a former spelling in other files, and leaves a file changed since the preview', async () => {
  const f = await fixture()
  try {
    const read = async (id: string) => readFile(path.join(f.root, id), 'utf8')
    await f.seed('people/2026/ja/Jane-Doe.md', '---\nname: [Jane Doe, Jane Doh]\n---\n\n# Jane Doe\n')
    const meeting = 'time/2026/W07/02-10/actions/meetings/09-00_Zoom_Planning.md'
    const message = 'time/2026/W07/02-11/actions/messages/10-00_Email_Hello.md'
    const note = 'time/2026/W07/02-12/actions/notes/11-00_Atlas.md'
    await f.seed(meeting, '---\nwho: Alex Kim, Jane Doh\nsummary: Planning\n---\n\nJane Doh led it.\n')
    await f.seed(message, '---\nfrom: Jane Doh\nto: Alex Kim\nsummary: Hello\n---\n')
    await f.seed(note, '---\nrel:\n  - Jane Doh\n  - projects/Atlas\n---\n')
    const before = await f.profiles.detail('person', 'people/2026/ja/Jane-Doe.md')
    const preview = await f.profiles.previewReferences('person', before.id, ['Jane Doh'])
    await f.seed(note, '---\nrel:\n  - Jane Doh\n  - projects/Atlas\n---\nAn edit after the preview.\n')
    const result = await f.profiles.updateReferences(
      'person',
      before.id,
      ['Jane Doh'],
      preview.files.map(({ id, revision }) => ({ id, revision })),
    )
    const after = await f.profiles.detail('person', before.id)
    assert({
      given: 'a profile whose old spelling three files still use, one of which changes after the preview',
      should: 'preview all three, rename two in place, and list the changed one as left alone',
      actual: [
        before.spellings,
        preview.files.map((file) => [file.kind, file.changes]),
        result,
        await read(meeting),
        await read(message),
        after.spellings,
      ],
      expected: [
        [{ name: 'Jane Doh', files: 3 }],
        [
          ['meetings', [{ field: 'who', before: 'Jane Doh', after: 'Jane Doe' }]],
          ['messages', [{ field: 'from', before: 'Jane Doh', after: 'Jane Doe' }]],
          ['notes', [{ field: 'rel', before: 'Jane Doh', after: 'Jane Doe' }]],
        ],
        { updated: 2, skipped: [{ id: note, label: '11-00_Atlas', reason: 'It changed after the preview.' }] },
        '---\nwho: Alex Kim, Jane Doe\nsummary: Planning\n---\n\nJane Doh led it.\n',
        '---\nfrom: Jane Doe\nto: Alex Kim\nsummary: Hello\n---\n',
        [{ name: 'Jane Doh', files: 1 }],
      ],
    })
    let refused = ''
    try {
      await f.profiles.previewReferences('person', before.id, ['Alex Kim'])
    } catch (error) {
      refused = (error as Error).message
    }
    assert({
      given: 'a request to rename a name this profile does not list',
      should: 'refuse it',
      actual: refused,
      expected: 'Choose among the other spellings this profile lists.',
    })
  } finally {
    await f.close()
  }
})

test('A rename moves the profile file to its new name and updates every path to it, keeping its URL', async () => {
  const f = await fixture()
  try {
    const read = async (id: string) => readFile(path.join(f.root, id), 'utf8')
    await f.seed('people/2026/ja/Jane-Doh.md', '---\nname: [Jane Doe, Jane Doh]\n---\n\n# Jane Doe\n')
    await f.seed('people/2026/ja/Jane-Doh-2.md', '---\nname: Jane Doh\n---\n\n# Another Jane Doh\n')
    const chat = 'time/2026/W07/02-12/actions/ai-chats/12-00_Planning.md'
    const log =
      '<!-- CONTEXT-LOG\n{\n  "turns": [\n    {\n      "universe": [\n        {"path":"people/2026/ja/Jane-Doh.md","tokens":85},\n        {"path":"people/2026/ja/Jane-Doh-2.md","tokens":12}\n      ]\n    }\n  ]\n}\n-->\n'
    await f.seed(chat, `---\nrel: [Jane Doh]\n---\n\nWe talked about people/2026/ja/Jane-Doh.md.\n\n${log}`)
    const before = await f.profiles.detail('person', 'people/2026/ja/Jane-Doh.md')
    const preview = await f.profiles.previewReferences('person', before.id, [])
    const result = await f.profiles.updateReferences(
      'person',
      before.id,
      [],
      preview.files.map(({ id, revision }) => ({ id, revision })),
      preview.file?.to,
    )
    const after = await f.profiles.resolveRoute('person', before.slug)
    assert({
      given:
        'a profile whose file still carries a misspelling that a chat writes out, and a namesake with a numbered file',
      should: "rename the file, change every whole path to it in the chat and nothing else, and keep the profile's URL",
      actual: [
        before.renameFile,
        preview.file,
        preview.files.map((file) => file.changes),
        result.file,
        await read(chat),
        await read('people/2026/ja/Jane-Doe.md'),
        after?.id,
      ],
      expected: [
        'people/2026/ja/Jane-Doe.md',
        { from: 'people/2026/ja/Jane-Doh.md', to: 'people/2026/ja/Jane-Doe.md' },
        [[{ field: 'path', before: 'people/2026/ja/Jane-Doh.md', after: 'people/2026/ja/Jane-Doe.md', count: 2 }]],
        'people/2026/ja/Jane-Doe.md',
        `---\nrel: [Jane Doh]\n---\n\nWe talked about people/2026/ja/Jane-Doe.md.\n\n${log.replace('people/2026/ja/Jane-Doh.md"', 'people/2026/ja/Jane-Doe.md"')}`,
        '---\nname: [Jane Doe, Jane Doh]\n---\n\n# Jane Doe\n',
        'people/2026/ja/Jane-Doe.md',
      ],
    })
  } finally {
    await f.close()
  }
})

test('Two organizations never share a name, alternate names and punctuation included', async () => {
  const f = await fixture()
  try {
    await f.seed('orgs/tech/software/Atlas-Inc.md', '---\nname: Atlas Inc\nalt: Atlas Labs\n---\n\n# Atlas Inc\n')
    const refused = async (save: () => Promise<unknown>) => {
      try {
        await save()
        return ''
      } catch (error) {
        return (error as Error).message
      }
    }
    const person = await f.profiles.save({
      ...blankProfile('person'),
      name: 'Jane Doe',
      current: [{ name: 'Atlas, Inc.' }],
    })
    assert({
      given: 'an organization named Atlas Inc, also known as Atlas Labs',
      should:
        'refuse another under its name, its alternate name, or either as an alternate name, and link a person who writes it with punctuation',
      actual: [
        await refused(() => f.profiles.save({ ...blankProfile('org'), name: 'Atlas, Inc.' })),
        await refused(() => f.profiles.save({ ...blankProfile('org'), name: 'Atlas Labs' })),
        await refused(() => f.profiles.save({ ...blankProfile('org'), name: 'Cedar', aliases: ['atlas labs'] })),
        person.current.map((org) => [org.name, org.id]),
        f.store.orgs.getAll().toArray().length,
      ],
      expected: [
        'An organization named Atlas, Inc. already exists. Open it, or give this one a name of its own.',
        'Atlas Labs is already a name of Atlas Inc. Open it, or give this one a name of its own.',
        'atlas labs is already a name of Atlas Inc. Choose another alternate name.',
        [['Atlas Inc', 'orgs/tech/software/Atlas-Inc.md']],
        1,
      ],
    })
  } finally {
    await f.close()
  }
})
