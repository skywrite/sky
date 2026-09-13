import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { profileContext } from '#commands/lib/chat/profileContext.ts'
import { AboutMeDocument } from '#shared/models/AboutMe/mod.ts'
import { assert, test } from '#test'
import { createAboutMeRoutes, type AboutMeProfile, type AboutMeSuggestion } from './aboutMe.ts'
import { createAboutMeHost } from './createAboutMeHost.ts'
import { isPublicProfileAddress, readProfilePage } from './profileLinks.ts'

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-about-me-'))
  const file = path.join(root, 'journal', 'about-me.md')
  const reads: string[] = []
  const host = createAboutMeHost(
    { DIR_BASE: root, DIR_STATE: path.join(root, '.state') },
    {
      today: () => '2026-01-15',
      readPage: async (url) => {
        reads.push(url)
        if (url.includes('/private')) throw new Error('Unavailable')
        return 'Jane Doe leads the Atlas project.'
      },
      summarize: async (input) => ({
        name: input.name || 'Jane Doe',
        text: `${input.text}\n\nI lead the [Atlas project](https://example.com/about).`.trim(),
        questions: ['What would you like to focus on next?'],
      }),
    },
  )
  const app = createAboutMeRoutes(host)
  const send = (route: string, body: unknown, method = 'PUT', headers = {}) =>
    app.request(route, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
  return { root, file, host, app, send, reads, dispose: () => rm(root, { recursive: true, force: true }) }
}

test('About me saves a usable first profile, preserves metadata, and rejects stale edits', async () => {
  const f = await fixture()
  try {
    const initial = await f.host.read()
    assert({
      given: 'an empty notebook',
      should: 'offer an empty editable profile without creating a file',
      actual: [initial.name, initial.text, initial.links, await profileContext({ FILE_ABOUT_ME: f.file })],
      expected: ['', '', [], ''],
    })
    const first = await f.send('/', {
      ...initial,
      name: 'Jane Doe',
      text: 'I build tools for small teams.',
      links: ['https://example.com/about'],
    })
    const saved = (await first.json()) as AboutMeProfile
    const doc = AboutMeDocument.fromMarkdown(await readFile(f.file, 'utf8'))
    assert({
      given: 'a profile saved from settings',
      should: 'be readable by existing profile and chat consumers',
      actual: [
        first.status,
        doc.fullName,
        doc.bio,
        doc.yaml.sites,
        (await profileContext({ FILE_ABOUT_ME: f.file })).includes(saved.text),
      ],
      expected: [200, 'Jane Doe', saved.text, ['https://example.com/about'], true],
    })
    await writeFile(f.file, (await readFile(f.file, 'utf8')).replace('updated:', 'custom: preserved\nupdated:'))
    const stale = await f.send('/', { ...saved, text: 'Stale overwrite' })
    const fresh = await f.host.read()
    await f.host.save({ ...fresh, text: 'My current focus is Atlas.' })
    const after = AboutMeDocument.fromMarkdown(await readFile(f.file, 'utf8'))
    assert({
      given: 'a concurrent notebook edit followed by a fresh save',
      should: 'refuse the stale save and retain unrelated metadata',
      actual: [
        stale.status,
        after.yaml.custom,
        after.yaml.created,
        after.bio,
        (await profileContext({ FILE_ABOUT_ME: f.file })).includes('My current focus is Atlas.'),
      ],
      expected: [409, 'preserved', '2026-01-15', 'My current focus is Atlas.', true],
    })
  } finally {
    await f.dispose()
  }
})

test('About me learns from readable links as an unsaved suggestion and handles inaccessible sources', async () => {
  const f = await fixture()
  try {
    const input = {
      name: 'Jane Doe',
      text: 'My own priorities come first.',
      links: ['https://example.com/about', 'https://example.com/private'],
    }
    const response = await f.send('/learn', input, 'POST')
    const suggestion = (await response.json()) as AboutMeSuggestion
    assert({
      given: 'one readable page and one inaccessible page',
      should: 'return sourced suggestions without saving or losing the supplied profile',
      actual: [
        response.status,
        suggestion.text.startsWith(input.text),
        suggestion.sources.length,
        !!suggestion.sources[1].error,
        (await f.host.read()).text,
      ],
      expected: [200, true, 2, true, ''],
    })
    const unavailable = await f.send('/learn', { ...input, links: ['https://example.com/private'] }, 'POST')
    const noLinks = await f.send('/learn', { ...input, links: [] }, 'POST')
    const invalid = await f.send('/learn', { ...input, links: ['javascript:alert(1)'] }, 'POST')
    const crossSite = await f.send('/learn', input, 'POST', { Origin: 'https://example.org' })
    assert({
      given: 'unreadable, absent, invalid, or cross-site link requests',
      should: 'offer actionable errors and reject unsafe requests',
      actual: [unavailable.status, noLinks.status, invalid.status, crossSite.status],
      expected: [422, 400, 400, 403],
    })
  } finally {
    await f.dispose()
  }
})

test('About me edits retain legacy sections and do not overwrite malformed frontmatter', async () => {
  const f = await fixture()
  try {
    await mkdir(path.dirname(f.file), { recursive: true })
    await writeFile(
      f.file,
      '---\ncreated: 2025-01-01\ncustom: retained\n---\n\n# About Me - Jane Doe\n\n## Family\n\nClose to my siblings.\n\n## Bio\n\nI lead Atlas.\n',
    )
    const before = await f.host.read()
    await f.host.save({ ...before, links: ['https://example.com'] })
    const legacy = AboutMeDocument.fromMarkdown(await readFile(f.file, 'utf8'))
    assert({
      given: 'an existing structured profile',
      should: 'keep its name, family, bio, and creation date when adding links',
      actual: [legacy.fullName, legacy.family, legacy.bio, legacy.created?.ymd],
      expected: ['Jane Doe', 'Close to my siblings.', 'I lead Atlas.', '2025-01-01'],
    })
    const broken = '---\nsites: [broken\n---\n\nKeep this text.'
    await writeFile(f.file, broken)
    const response = await f.send('/', before)
    assert({
      given: 'invalid frontmatter',
      should: 'preserve the file and explain the conflict',
      actual: [response.status, await readFile(f.file, 'utf8')],
      expected: [409, broken],
    })
  } finally {
    await f.dispose()
  }
})

test('Profile link reader refuses local addresses and non-web protocols before requesting content', async () => {
  const addresses = [
    '127.0.0.1',
    '10.2.3.4',
    '169.254.169.254',
    '::1',
    '::ffff:127.0.0.1',
    'fd00::1',
    '93.184.216.34',
    '2606:4700:4700::1111',
  ]
  const results = await Promise.allSettled(
    ['http://127.0.0.1/', 'http://[::1]/', 'file:///tmp/profile', 'https://user:pass@example.com/'].map(
      readProfilePage,
    ),
  )
  assert({
    given: 'private addresses, credentials, and non-web links',
    should: 'reject them while allowing public IP addresses',
    actual: [addresses.map(isPublicProfileAddress), results.map((result) => result.status)],
    expected: [
      [false, false, false, false, false, false, true, true],
      ['rejected', 'rejected', 'rejected', 'rejected'],
    ],
  })
})
