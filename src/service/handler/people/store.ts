import { lstat, readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { isMap, isScalar, parseDocument, type Document as YamlDocument } from 'yaml'
import {
  nameToFileStem,
  organizationDir,
  organizationDocument,
  pathHostileCategory,
  type OrganizationDraft,
  type OrganizationRequest,
} from '#commands/all/org/lib/document.ts'
import { orgNameKey } from '#commands/all/org/lib/name.ts'
import {
  generatePersonHierarchyPath,
  metValue,
  newPersonMarkdown,
  personFileStem,
} from '#commands/all/person/lib/create.ts'
import { withProcessLock } from '#lib/jobs/files.ts'
import { linkedInUrl } from '#lib/linkedin/types.ts'
import { createNumberedFile } from '#lib/nbfs/createNumberedFile.ts'
import { atomicWrite, hash } from '#lib/outbox/files.ts'
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
  companyLink,
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

/** Opening lines go under the name heading. */
const withNotes = (body: string, notes?: string) =>
  notes?.trim() ? body.replace(/^(# .*)$/m, `$1\n\n${notes.trim()}`) : body

/** A field emptied by an edit is left out; a map with nothing left in it goes too, never `{}`. */
function dropEmpty(yaml: YamlDocument, key: string): void {
  const node = yaml.get(key, true)
  if (isMap(node) && node.items.length === 0) yaml.delete(key)
}

function fields(type: ProfileType, doc: Document): ProfileFields {
  const yaml = doc.yaml
  const person = type === 'person' ? (doc as PersonDocument) : null
  const org = type === 'org' ? (doc as OrganizationDocument) : null
  const names = strings(yaml.name ?? yaml.who)
  const email =
    yaml.email && typeof yaml.email === 'object' ? (yaml.email as Record<string, unknown>) : { personal: yaml.email }
  const current = unique([...(person?.orgs.current ?? []), ...(person?.org ? [person.org] : [])])
  // Organizations are linked by name, as every notebook reference is
  const choices = (values: string[]) => values.map((name) => ({ name }))
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
    current: choices(current),
    past: choices(person?.orgs.past ?? []),
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
  // org:new's lookup reads the website and Wikipedia and asks a model; load it only when used.
  const draftOrganization =
    options.draftOrganization ??
    (async (request: OrganizationRequest) =>
      (await import('#commands/all/org/lib/draft.ts')).draftOrganization(options.orgsDir, request))
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
    // The line breaks between the closing `---` and the body, kept as the file has them
    const gap = raw.slice(0, raw.length - split.markdown.length).match(/\n*$/)?.[0] || '\n'
    return { file, raw, yaml, gap, body: split.markdown, doc, revision: hash(raw) }
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

  /** Today in the notebook's timezone, YYYY-MM-DD. */
  const today = () => (options.now ?? fetchNowSync)().plainDateTime.toString().slice(0, 10)

  /** Write a new profile as `<stem>.md` in `dir`, numbering namesakes; never overwrites. */
  async function createFile(dir: string, stem: string, contents: string): Promise<string> {
    await safeFile(dir)
    const file = await createNumberedFile(dir, stem, contents)
    store.set(file, contents)
    return relative(file)
  }

  /** A new person, made as person:new makes one, holding what the form holds. */
  async function createPerson(
    input: SaveProfile,
    orgs: { current: OrganizationChoice[]; past: OrganizationChoice[] },
    aliases: string[],
    date: string,
  ): Promise<string> {
    const names = (choices: OrganizationChoice[]) => choices.map((org) => org.name)
    const contents = newPersonMarkdown({
      name: aliases.length ? [input.name, ...aliases] : input.name,
      met: input.met || date,
      created: date,
      location: input.location,
      title: input.title,
      orgs: { current: names(orgs.current), past: names(orgs.past) },
      email: { personal: input.emailPersonal, business: input.emailBusiness },
      sites: input.sites,
      notes: input.notes,
    })
    const dir = path.join(options.peopleDir, generatePersonHierarchyPath(input.name, Number(date.slice(0, 4))))
    return createFile(dir, personFileStem(input.name), contents)
  }

  /** A new organization, looked up and filed as org:new does, holding what the form holds. */
  async function createOrganization(
    org: {
      name: string
      sites: string[]
      sector?: string
      kind?: ProfileFields['kind']
      aliases?: string[]
      location?: string
      notes?: string
    },
    date: string,
  ): Promise<string> {
    const website = org.sites.find((site) => companyLink(site) === null)
    let draft: OrganizationDraft
    try {
      draft = await draftOrganization({ name: org.name, site: website, sector: org.sector || undefined })
    } catch (error) {
      throw new ProfileError(`${org.name} could not be looked up: ${(error as Error).message}`, 503)
    }
    const hostile = pathHostileCategory(draft)
    if (hostile) throw new ProfileError(`Use letters, digits, and hyphens for the ${hostile.label}: ${hostile.value}.`)
    let doc = organizationDocument(draft, { sites: org.sites.filter((site) => site !== website), created: date })
    // A kind chosen in the form wins over the lookup's
    if (org.kind && org.kind !== 'unknown') doc = doc.setKind(org.kind)
    const split = splitYamlMarkdown(doc.toMarkdown())
    let frontmatter = `${split.yaml}\n`
    if (org.aliases?.length || org.location) {
      const yaml = parseDocument(split.yaml)
      if (org.aliases?.length) yaml.set('alt', org.aliases.join('; '))
      if (org.location) yaml.set('location', org.location)
      frontmatter = yaml.toString()
    }
    const contents = `---\n${frontmatter}---\n\n${withNotes(split.markdown, org.notes)}`
    return createFile(organizationDir(options.orgsDir, draft), nameToFileStem(org.name), contents)
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
      // People may share a name. Two organizations never do: an organization is linked by its
      // name, so each of its names, alternate ones included, is its own.
      const orgNamed = (name: string) =>
        all.orgs.find(
          (org) =>
            org.id !== input.id && [org.name, ...org.aliases].some((other) => orgNameKey(other) === orgNameKey(name)),
        )
      if (input.type === 'org') {
        const clash = orgNamed(input.name)
        if (clash)
          throw new ProfileError(
            orgNameKey(clash.name) === orgNameKey(input.name)
              ? `An organization named ${input.name} already exists. Open it, or give this one a name of its own.`
              : `${input.name} is already a name of ${clash.name}. Open it, or give this one a name of its own.`,
            409,
          )
        for (const alias of input.aliases) {
          const other = orgNamed(alias)
          if (other)
            throw new ProfileError(`${alias} is already a name of ${other.name}. Choose another alternate name.`, 409)
        }
      } else if (sameName.length && !input.allowNamesake)
        throw new ProfileError(
          'A profile with this name already exists. Open it, or confirm this is a different person.',
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
        // A person's organizations are written by name, which must say which organization it is
        const name = orgNameKey(matches.length === 1 ? matches[0]!.name : choice.name)
        const named = all.orgs.filter((org) => [org.name, ...org.aliases].some((alias) => orgNameKey(alias) === name))
        if (named.length > 1)
          throw new ProfileError(
            `More than one organization is named ${choice.name}. Give one of them a name of its own first.`,
            409,
          )
        if (choice.create && named.length)
          throw new ProfileError(
            `An organization named ${choice.name} already exists. Choose it, or add the new one under a name of its own.`,
            409,
          )
        if (organizationNeedsChoice(choice, all.orgs))
          throw new ProfileError(
            `${choice.name} has a different LinkedIn page than the organization of that name. Choose that organization, or add the new one under a name of its own.`,
            409,
          )
      }
      const date = today()
      const resolve = async (choices: OrganizationChoice[]): Promise<OrganizationChoice[]> => {
        const resolved: OrganizationChoice[] = []
        for (const choice of choices) {
          const matches = organizationMatches(choice, summaries('org'))
          if (matches.length === 1) resolved.push({ name: matches[0].name, id: matches[0].id })
          else {
            const sites = choice.linkedin ? [linkedInUrl(choice.linkedin, 'org')] : []
            resolved.push({ name: choice.name, id: await createOrganization({ name: choice.name, sites }, date) })
          }
        }
        return resolved
      }
      const next = { ...input, current: await resolve(input.current), past: await resolve(input.past) }
      const previous = current ? fields(input.type, current.doc) : blankProfile(input.type)
      const aliases = unique([
        ...input.aliases,
        ...(current && previous.name !== input.name ? [previous.name] : []),
      ]).filter((name) => plain(name) !== plain(input.name))

      if (!current) {
        const id =
          input.type === 'person'
            ? await createPerson(input, next, aliases, date)
            : await createOrganization(
                {
                  name: input.name,
                  sites: input.sites,
                  sector: input.sector,
                  kind: input.kind,
                  aliases,
                  location: input.location,
                  notes: input.notes,
                },
                date,
              )
        return detail(input.type, id)
      }

      const yaml = current.yaml
      const set = (key: string, value: unknown) =>
        value === '' || value === undefined ? yaml.delete(key) : yaml.set(key, value)
      // A blank or scalar field becomes a map before anything is set inside it.
      const mapAt = (key: string) => {
        if (yaml.has(key) && !isMap(yaml.get(key, true))) yaml.delete(key)
      }
      if (previous.name !== input.name || !same(previous.aliases, aliases)) {
        set('name', input.type === 'person' && aliases.length ? [input.name, ...aliases] : input.name)
        if (input.type === 'org') set('alt', aliases.join('; '))
        else {
          yaml.delete('alt')
          yaml.delete('names')
          yaml.delete('who')
        }
      }
      for (const key of ['title', 'location', 'sector'] as const) if (input[key] !== previous[key]) set(key, input[key])
      if (input.met !== previous.met) set('met', input.met ? metValue(input.met) : undefined)
      for (const [key, values, old] of [
        ['personal', input.emailPersonal, previous.emailPersonal],
        ['business', input.emailBusiness, previous.emailBusiness],
      ] as const) {
        if (same(values, old)) continue
        if (typeof current.doc.yaml.email === 'string') yaml.set('email', { personal: previous.emailPersonal })
        if (values.length) {
          mapAt('email')
          yaml.setIn(['email', key], values)
        } else if (yaml.hasIn(['email', key])) yaml.deleteIn(['email', key])
      }
      dropEmpty(yaml, 'email')
      /** Set `key` where `other` stood when only that one exists; `other` goes either way. */
      const setInPlaceOf = (key: string, other: string, value: unknown) => {
        const map = yaml.contents
        const at =
          !yaml.has(key) && isMap(map)
            ? map.items.findIndex((item) => (isScalar(item.key) ? item.key.value : item.key) === other)
            : -1
        if (at >= 0 && isMap(map)) {
          // A parsed map types its pairs as parsed nodes; at run time it holds any pair.
          map.items.splice(at, 1, yaml.createPair(key, value) as (typeof map.items)[number])
        } else {
          yaml.set(key, value)
          yaml.delete(other)
        }
      }
      if (!same(input.sites, previous.sites)) {
        yaml.delete('linkedin')
        // An organization keeps one website in `site`, several in `sites`, never both.
        if (!input.sites.length) {
          yaml.delete('site')
          yaml.delete('sites')
        } else if (input.type === 'org' && input.sites.length === 1) setInPlaceOf('site', 'sites', input.sites[0])
        else setInPlaceOf('sites', 'site', input.sites)
      }
      const orgNames = (choices: OrganizationChoice[]) => choices.map((org) => org.name)
      if (
        input.type === 'person' &&
        (!same(orgNames(next.current), orgNames(previous.current)) ||
          !same(orgNames(next.past), orgNames(previous.past)))
      ) {
        yaml.delete('org')
        for (const status of ['current', 'past'] as const) {
          const names = orgNames(next[status])
          if (names.length) {
            mapAt('orgs')
            yaml.setIn(['orgs', status], names)
          } else if (yaml.hasIn(['orgs', status])) yaml.deleteIn(['orgs', status])
        }
        dropEmpty(yaml, 'orgs')
      }
      if (input.type === 'org' && input.kind !== previous.kind) {
        const org = new OrganizationDocument(current.doc.yaml).setKind(input.kind)
        set('tags', org.yaml.tags)
      }
      set('updated', date)
      const contents = `---\n${yaml.toString()}---${current.gap}${current.body}`
      // Catch an external editor saving while related organization files were being created.
      if (hash(await readFile(current.file, 'utf8')) !== current.revision)
        throw new ProfileError('This profile changed while saving. Reload it before trying again.', 409)
      await atomicWrite(current.file, contents)
      store.set(current.file, contents)
      return detail(input.type, input.id!)
    })
  }

  async function addNote(type: ProfileType, id: string, revision: string, text: string): Promise<ProfileDetail> {
    return withProcessLock(lock, async () => {
      const current = await snapshot(type, id)
      if (revision !== current.revision)
        throw new ProfileError('This profile changed. Reload it before adding your note.', 409)
      const date = today()
      current.yaml.set('updated', date)
      const contents = `---\n${current.yaml.toString()}---${current.gap}${current.body.trimEnd()}\n\n## ${date}\n\n${text.trim()}\n`
      await atomicWrite(current.file, contents)
      store.set(current.file, contents)
      return detail(type, id)
    })
  }
  return { index, detail, resolveRoute, save, addNote }
}
