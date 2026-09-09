import * as path from 'node:path'
import { normalizePlaceRef, type PlaceKind } from '#shared/models/Place/mod.ts'
import type PlaceStore from '#shared/models/Store/PlaceStore/mod.ts'
import { countryPlace, countryPlaces } from './geography.ts'

export interface PlaceChoice {
  ref: string
  name: string
  aliases: string[]
  refs: string[]
  kind: PlaceKind
  path: string
  context: string[]
  hint: string
  needsCreation: boolean
}

export interface PlaceMention {
  name: string
  /** Containing places explicitly named in the source, never inferred from familiarity. */
  context?: string[]
  kind?: PlaceKind | null
}

export interface PlaceMatch {
  mention: PlaceMention
  ref?: string
  candidates: PlaceChoice[]
}

export function normalizePlaceName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** One roster for automatic subject resolution and manual selection, including unsaved countries. */
export function placeChoices(store: PlaceStore): PlaceChoice[] {
  const choices: PlaceChoice[] = []
  for (const { placePath: ref, path: file, value: doc } of store.getEntries()) {
    if (store.findByPlacePath(ref)?.path !== file) continue
    const fileRef = store.directory ? normalizePlaceRef(`places/${path.relative(store.directory, file)}`) : undefined
    const refs = [ref, ...doc.refAliases, ...(fileRef ? [fileRef] : [])].filter(
      (alias) => store.findByPlacePath(alias)?.path === file,
    )
    const context = new Set<string>(ref.split('/').slice(1, -1))
    const location = doc.location
    for (const value of [location?.country, location?.region, location?.city, location?.subcity]) {
      if (value) context.add(value)
    }
    const countryCode = location?.country ?? ref.split('/')[1]
    const country = countryCode ? countryPlace(`places/${countryCode}`) : undefined
    if (country) for (const value of [country.name, ...country.aliases]) context.add(value)
    const visited = new Set<string>([ref.toLowerCase()])
    let parent = doc.parent
    while (parent && !visited.has(parent.toLowerCase())) {
      visited.add(parent.toLowerCase())
      const entry = store.findByPlacePath(parent)
      if (!entry) break
      for (const value of [entry.value.name, ...entry.value.aliases]) context.add(value)
      parent = entry.value.parent
    }
    choices.push({
      ref,
      name: doc.name,
      aliases: [...doc.aliases],
      refs: [...new Set(refs)],
      kind: doc.kind,
      path: file,
      context: [...context],
      hint: [doc.kind, doc.toLocationDisplayString() || doc.parent || ref].join(' · '),
      needsCreation: false,
    })
  }
  if (!store.directory) return choices
  for (const country of countryPlaces()) {
    const ref = country.ref!
    const existing = store.findByPlacePath(ref)
    if (existing) {
      const choice = choices.find((item) => item.path === existing.path)
      if (choice) choice.aliases = [...new Set([...choice.aliases, country.name, ...country.aliases])]
      continue
    }
    const file = path.join(store.directory, 'locations', `${country.toFilePath()}.md`)
    if (store.hasPlacePath(ref) || store.findByPath(file)) continue
    choices.push({
      ref,
      name: country.name,
      aliases: country.aliases,
      refs: [ref],
      kind: 'country',
      path: file,
      context: [country.name, ...country.aliases],
      hint: 'Country',
      needsCreation: true,
    })
  }
  return choices
}

export function placeChoiceForRef(raw: string, choices: PlaceChoice[]): PlaceChoice | undefined {
  const ref = normalizePlaceRef(raw)?.toLowerCase()
  if (!ref) return undefined
  const matches = choices.filter((choice) => choice.refs.some((r) => r.toLowerCase() === ref))
  return matches.length === 1 ? matches[0] : undefined
}

/** Names match exactly (including aliases); explicit geographic context can narrow a namesake. */
export function matchPlace(mention: PlaceMention, choices: PlaceChoice[]): PlaceMatch {
  const target = normalizePlaceName(mention.name)
  const explicit = placeChoiceForRef(mention.name, choices)
  const named = explicit
    ? [explicit]
    : choices.filter((choice) => [choice.name, ...choice.aliases].some((name) => normalizePlaceName(name) === target))
  const matches = named.filter(
    (choice) =>
      (!mention.kind || choice.kind === mention.kind) &&
      (mention.context ?? []).every((context) =>
        choice.context.some((c) => normalizePlaceName(c) === normalizePlaceName(context)),
      ),
  )
  return { mention, ref: matches.length === 1 ? matches[0]!.ref : undefined, candidates: matches }
}
