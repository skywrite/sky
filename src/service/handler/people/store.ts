import { lstat, mkdir, readdir, readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { isMap, parseDocument } from 'yaml'
import { withProcessLock } from '#lib/jobs/files.ts'
import { linkedInUrl } from '#lib/linkedin/types.ts'
import { createDayFile } from '#lib/nbfs/createDayFile.ts'
import { atomicWrite, hash } from '#lib/outbox/files.ts'
import { slugify } from '#lib/string/mod.ts'
import { workstreamIdentityTime } from '#lib/workstreams/identities.ts'
import type Document from '#shared/models/Markdown/Document/mod.ts'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import splitYamlMarkdown from '#shared/models/Markdown/util/splitYamlMarkdown.ts'
import OrganizationDocument from '#shared/models/Organization/mod.ts'
import PersonDocument from '#shared/models/Person/mod.ts'
import { fetchNowSync } from '#shared/nbfs/mod.ts'
import { isPathWithinRoot, isPathWithinRoots } from '../markdown-preview/request.ts'
import { backlinksOf } from '../vocabulary/mod.ts'
import { renderProfileNotes } from './notes.ts'
import { profileRoutes } from './routes.ts'
import {
  blankProfile,
  organizationMatches,
  organizationNeedsChoice,
  ProfileError,
  type OrganizationChoice,
  type PeopleIndex,
  type PeopleOptions,
  type ProfileDetail,
  type ProfileFields,
  type ProfileSummary,
  type ProfileType,
  type SaveProfile,
} from './types.ts'

const plain = (value: string) => value.trim().toLocaleLowerCase()
const string = (value: unknown): string => (typeof value === 'string' ? value : '')
const strings = (value: unknown): string[] =>
  (Array.isArray(value) ? value : string(value).split(';'))
    .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    .map((item) => item.trim())
const unique = (values: string[]) => [...new Map(values.map((value) => [plain(value), value])).values()]
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function fields(type: ProfileType, doc: Document): ProfileFields {
  const yaml = doc.yaml
  const person = type === 'person' ? (doc as PersonDocument) : null
  const org = type === 'org' ? (doc as OrganizationDocument) : null
  const names = strings(yaml.name ?? yaml.who)
  const email =
    yaml.email && typeof yaml.email === 'object' ? (yaml.email as Record<string, unknown>) : { personal: yaml.email }
  const current = unique([...(person?.orgs.current ?? []), ...(person?.org ? [person.org] : [])])
  const refs = yaml.org_refs as Record<string, Array<{ name: string; path: string }>> | undefined
  const choices = (values: string[], status: 'current' | 'past') =>
    values.map((name) => {
      const ref = Array.isArray(refs?.[status])
        ? refs[status].find((ref) => ref && plain(string(ref.name)) === plain(name))
        : undefined
      return { name, ...(typeof ref?.path === 'string' ? { id: ref.path } : {}) }
    })
  return {
    ...blankProfile(type),
    name: names[0] ?? '',
    aliases: unique([...names.slice(1), ...strings(yaml.alt), ...strings(yaml.names)]),
    title: string(yaml.title),
    location: string(yaml.location),
    emailPersonal: strings(email.personal),
    emailBusiness: strings(email.business),
    sites: unique([...strings(yaml.sites), ...strings(yaml.site), ...strings(yaml.linkedin)]),
    met: typeof yaml.met === 'number' ? String(yaml.met) : string(yaml.met),
    current: choices(current, 'current'),
    past: choices(person?.orgs.past ?? [], 'past'),
    kind: org?.kind ?? 'unknown',
    sector: string(yaml.sector),
  }
}

export function createPeopleStore(store: MarkdownStore, baseDir: string, dirs: string[], options: PeopleOptions) {
  const base = path.resolve(baseDir)
  const stateDir = path.join(options.stateDir, 'people', hash(base).slice(0, 16))
  const lock = path.join(stateDir, 'write.lock')
  const relative = (file: string) => path.relative(base, file).split(path.sep).join('/')
  const entries = (type: ProfileType) =>
    type === 'person' ? store.people.getAll().toArray() : store.orgs.getAll().toArray()
  const allowed = (file: string) => isPathWithinRoot(file, base) && isPathWithinRoots(file, dirs)
  let cached: { version: number; value: Promise<PeopleIndex> } | undefined

  async function safeFile(file: string): Promise<void> {
    if (!allowed(file)) throw new ProfileError('This record is outside your notebook folders.', 403)
    let at = base
    for (const part of path.relative(base, file).split(path.sep)) {
      at = path.join(at, part)
      try {
        if ((await lstat(at)).isSymbolicLink()) throw new ProfileError('Profiles must be regular notebook files.', 403)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
  }

  const find = (type: ProfileType, id: string) => {
    const entry = entries(type).find((entry) => relative(entry.path) === id && allowed(entry.path))
    if (!entry) throw new ProfileError('This profile could not be found.', 404)
    return entry
  }

  function summaries(type: ProfileType): Omit<ProfileSummary, 'slug' | 'score'>[] {
    return entries(type)
      .filter((entry) => allowed(entry.path))
      .map(({ doc, path: file }) => {
        const id = relative(file)
        const activity = backlinksOf(store, base, id).filter((item) => item.type === 'day' || item.type === 'library')
        const lastInteraction = activity
          .map((item) => item.date)
          .filter((date): date is string => Boolean(date))
          .sort()
          .at(-1)
        return { ...fields(type, doc), id, ...(lastInteraction ? { lastInteraction } : {}) }
      })
  }

  const resolveChoices = (choices: OrganizationChoice[], orgs: ProfileSummary[]) =>
    choices.map((choice) => {
      const matches = organizationMatches(choice, orgs)
      return matches.length === 1
        ? { name: matches[0].name, id: matches[0].id, slug: matches[0].slug, linkedin: choice.linkedin }
        : { ...choice }
    })

  async function buildIndex(): Promise<PeopleIndex> {
    const orgRecords = summaries('org')
    const personRecords = summaries('person')
    const identities = (['person', 'org'] as const).flatMap((type) =>
      entries(type)
        .filter((entry) => allowed(entry.path))
        .map(({ doc, path: file }) => ({
          type,
          id: relative(file),
          name: fields(type, doc).name,
          fingerprint: hash(doc.toMarkdown()),
        })),
    )
    const routes = await profileRoutes(stateDir, identities)
    const routed = (record: Omit<ProfileSummary, 'slug' | 'score'>): ProfileSummary => ({
      ...record,
      slug: routes.get(`${record.type}:${record.id}`)!,
      score: 0,
    })
    const orgs = orgRecords.map(routed)
    const people = personRecords.map((person) => ({
      ...routed(person),
      current: resolveChoices(person.current, orgs),
      past: resolveChoices(person.past, orgs),
    }))
    return { people, orgs, linkedInAvailable: Boolean(options.linkedIn) }
  }

  async function index(): Promise<PeopleIndex> {
    if (cached?.version !== store.version) {
      const value = buildIndex()
      cached = { version: store.version, value }
      void value.catch(() => {
        if (cached?.value === value) cached = undefined
      })
    }
    const value = await cached!.value
    // Scoring updates independently of MarkdownStore; never cache a score with profile metadata.
    const scores = options.scores?.()
    const scored = (profile: ProfileSummary): ProfileSummary => {
      const byName = profile.type === 'person' ? scores?.people : scores?.orgs
      const score = Math.max(
        0,
        ...[profile.name, ...profile.aliases].map((name) => byName?.get(plain(name))?.score ?? 0),
      )
      return { ...profile, score }
    }
    return { ...value, people: value.people.map(scored), orgs: value.orgs.map(scored) }
  }

  async function resolveRoute(type: ProfileType, route: string): Promise<ProfileSummary | undefined> {
    const all = await index()
    const rows = type === 'person' ? all.people : all.orgs
    return (
      rows.find((item) => item.slug === route) ?? rows.find((item) => item.id === route || item.id === `${route}.md`)
    )
  }

  async function snapshot(type: ProfileType, id: string) {
    const { path: file } = find(type, id)
    await safeFile(file)
    let raw: string
    try {
      raw = await readFile(file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new ProfileError('This profile was moved or removed. Reload the list.', 404)
      throw error
    }
    const split = splitYamlMarkdown(raw)
    const yaml = parseDocument(split.yaml)
    if (yaml.errors.length || (yaml.contents && !isMap(yaml.contents)))
      throw new ProfileError('This file has invalid frontmatter. Fix it in the notebook before editing here.', 409)
    const doc = type === 'person' ? PersonDocument.fromMarkdown(raw) : OrganizationDocument.fromMarkdown(raw)
    if (doc.yamlError)
      throw new ProfileError('This file has invalid frontmatter. Fix it in the notebook before editing here.', 409)
    // A file watcher can lag a read; publish the exact version the editor is reviewing.
    if (find(type, id).doc.toMarkdown() !== doc.toMarkdown()) store.set(file, raw)
    return { file, raw, yaml, body: split.markdown, doc, revision: hash(raw) }
  }

  async function detail(type: ProfileType, id: string): Promise<ProfileDetail> {
    const current = await snapshot(type, id)
    const all = await index()
    const summary = (type === 'person' ? all.people : all.orgs).find((item) => item.id === id)!
    const activity = backlinksOf(store, base, id)
      .filter((item) => allowed(path.resolve(base, item.path)))
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
    return {
      ...summary,
      revision: current.revision,
      html: renderProfileNotes(current.body),
      tags: [...current.doc.tags],
      activity,
      people: type === 'org' ? all.people.filter((person) => person.current.some((org) => org.id === id)) : [],
    }
  }

  function creationTime(): string {
    const now = (options.now ?? fetchNowSync)()
    return options.now ? `${now.plainDateTime.toString()}:00` : workstreamIdentityTime(now.timezone)
  }

  async function publish(type: ProfileType, name: string, contents: string, time: string): Promise<string> {
    const root = type === 'person' ? options.peopleDir : options.orgsDir
    const dir = path.join(root, time.slice(0, 4))
    await safeFile(dir)
    await mkdir(dir, { recursive: true })
    const stem = `${time.slice(0, 10)}_${time.slice(11, 19).replaceAll(':', '')}_${slugify(name, { preserveCase: true }).slice(0, 100) || (type === 'person' ? 'Person' : 'Organization')}`
    const existing = new Set((await readdir(dir)).map(plain))
    for (let suffix = 1; suffix < 10_000; suffix++) {
      const filename = `${stem}${suffix === 1 ? '' : `-${suffix}`}.md`
      if (existing.has(plain(filename))) continue
      const file = path.join(dir, filename)
      if (!(await createDayFile(file, contents))) continue
      store.set(file, contents)
      return relative(file)
    }
    throw new ProfileError('Could not allocate a unique filename. Try again.', 409)
  }

  async function save(input: SaveProfile): Promise<ProfileDetail> {
    return withProcessLock(lock, async () => {
      const current = input.id ? await snapshot(input.type, input.id) : null
      if (current && input.revision !== current.revision)
        throw new ProfileError(
          'This profile changed since you opened it. Your draft is still here; reload the profile before saving.',
          409,
        )
      const all = await index()
      const candidates = input.type === 'person' ? all.people : all.orgs
      const sameName = candidates.filter(
        (item) =>
          item.id !== input.id && [item.name, ...item.aliases].some((name) => plain(name) === plain(input.name)),
      )
      const linkedIn = input.sites.flatMap((site) => {
        try {
          return [plain(linkedInUrl(site, input.type))]
        } catch {
          return []
        }
      })
      const sameSource = candidates.find(
        (item) =>
          item.id !== input.id &&
          item.sites.some((site) => {
            try {
              return linkedIn.includes(plain(linkedInUrl(site, input.type)))
            } catch {
              return false
            }
          }),
      )
      if (sameSource)
        throw new ProfileError(
          `This LinkedIn profile is already saved as ${sameSource.name}. Open that record to edit it.`,
          409,
        )
      if (sameName.length && !input.allowNamesake)
        throw new ProfileError(
          'A profile with this name already exists. Open it, or confirm this is a different person or organization.',
          409,
        )

      // Validate every match before creating any files. An ambiguous organization never wins by index order.
      for (const choice of [...input.current, ...input.past]) {
        if (choice.linkedin) {
          try {
            linkedInUrl(choice.linkedin, 'org')
          } catch (error) {
            throw new ProfileError((error as Error).message)
          }
        }
        const matches = organizationMatches(choice, all.orgs)
        if (choice.id && !matches.length)
          throw new ProfileError(`The organization ${choice.name} no longer exists. Choose it again.`, 409)
        if (organizationNeedsChoice(choice, all.orgs))
          throw new ProfileError(
            `More than one organization could be ${choice.name}. Choose an existing record or create a separate organization.`,
            409,
          )
      }
      const time = creationTime()
      const today = time.slice(0, 10)
      const resolve = async (choices: OrganizationChoice[]): Promise<OrganizationChoice[]> => {
        const resolved: OrganizationChoice[] = []
        for (const choice of choices) {
          const matches = organizationMatches(choice, summaries('org'))
          if (matches.length === 1) resolved.push({ name: matches[0].name, id: matches[0].id })
          else {
            const doc = OrganizationDocument.create({
              name: choice.name,
              created: today,
              updated: today,
              ...(choice.linkedin ? { sites: [linkedInUrl(choice.linkedin, 'org')] } : {}),
            })
            const id = await publish('org', choice.name, doc.toMarkdown(), time)
            resolved.push({ name: choice.name, id })
          }
        }
        return resolved
      }
      const next = { ...input, current: await resolve(input.current), past: await resolve(input.past) }
      const previous = current ? fields(input.type, current.doc) : blankProfile(input.type)
      const yaml = current?.yaml ?? parseDocument('')
      const set = (key: string, value: unknown) =>
        value === '' || value === undefined ? yaml.delete(key) : yaml.set(key, value)
      const aliases = unique([
        ...input.aliases,
        ...(current && previous.name !== input.name ? [previous.name] : []),
      ]).filter((name) => plain(name) !== plain(input.name))
      if (!current || previous.name !== input.name || !same(previous.aliases, aliases)) {
        set('name', input.type === 'person' && aliases.length ? [input.name, ...aliases] : input.name)
        if (input.type === 'org') set('alt', aliases.join('; '))
        else {
          yaml.delete('alt')
          yaml.delete('names')
          yaml.delete('who')
        }
      }
      for (const key of ['title', 'location', 'met', 'sector'] as const)
        if (!current || input[key] !== previous[key]) set(key, input[key])
      for (const [key, values, old] of [
        ['personal', input.emailPersonal, previous.emailPersonal],
        ['business', input.emailBusiness, previous.emailBusiness],
      ] as const) {
        if (!same(values, old)) {
          if (typeof current?.doc.yaml.email === 'string') yaml.set('email', { personal: previous.emailPersonal })
          yaml.setIn(['email', key], values)
        }
      }
      if (!current || !same(input.sites, previous.sites)) {
        set('sites', input.sites.length ? input.sites : undefined)
        yaml.delete('site')
        yaml.delete('linkedin')
        if (input.type === 'org' && input.sites[0]) set('site', input.sites[0])
      }
      if (
        input.type === 'person' &&
        (!current || !same(next.current, previous.current) || !same(next.past, previous.past))
      ) {
        yaml.delete('org')
        yaml.setIn(
          ['orgs', 'current'],
          next.current.map((org) => org.name),
        )
        yaml.setIn(
          ['orgs', 'past'],
          next.past.map((org) => org.name),
        )
        // Human names remain compatible with CLI readers; paths disambiguate namesakes in the UI.
        set('org_refs', {
          current: next.current.map((org) => ({ name: org.name, path: org.id })),
          past: next.past.map((org) => ({ name: org.name, path: org.id })),
        })
      }
      if (input.type === 'org' && input.kind !== previous.kind) {
        const org = new OrganizationDocument(current?.doc.yaml ?? {}).setKind(input.kind)
        set('tags', org.yaml.tags)
      }
      if (!current) set('created', today)
      set('updated', today)
      const body = current?.body ?? `\n# ${input.name}\n\n${input.notes?.trim() || ''}\n`
      const contents = `---\n${yaml.toString()}---\n${body}`
      let id = input.id
      if (current) {
        // Catch an external editor saving while related organization files were being created.
        if (hash(await readFile(current.file, 'utf8')) !== current.revision)
          throw new ProfileError('This profile changed while saving. Reload it before trying again.', 409)
        await atomicWrite(current.file, contents)
        store.set(current.file, contents)
      } else id = await publish(input.type, input.name, contents, time)
      return detail(input.type, id!)
    })
  }

  async function addNote(type: ProfileType, id: string, revision: string, text: string): Promise<ProfileDetail> {
    return withProcessLock(lock, async () => {
      const current = await snapshot(type, id)
      if (revision !== current.revision)
        throw new ProfileError('This profile changed. Reload it before adding your note.', 409)
      const today = creationTime().slice(0, 10)
      current.yaml.set('updated', today)
      const contents = `---\n${current.yaml.toString()}---\n${current.body.trimEnd()}\n\n## ${today}\n\n${text.trim()}\n`
      await atomicWrite(current.file, contents)
      store.set(current.file, contents)
      return detail(type, id)
    })
  }
  return { index, detail, resolveRoute, save, addNote }
}
