/**
 * Shared GraphQL schema and yoga instance factory.
 *
 * Uses the DomainCollection master schema (schema.graphql) as the base,
 * with legacy extensions for VSCode autocomplete and subscriptions.
 *
 * Used by both run.ts (production) and server.ts (testing).
 */

import { createSchema, createYoga, type YogaServerInstance } from 'graphql-yoga'
import { readTextFileSync } from '#shared/fs/mod.ts'
import { createDomainResolvers } from '#shared/models/DomainCollection/query/resolvers/mod.ts'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { normalizeName } from '#shared/models/Store/normalize.ts'
import type { Store } from '../store.ts'
import * as resolvers from './resolvers/mod.ts'

/**
 * Context passed to resolvers.
 */
export interface GraphQLContext {
  store: Store
  markdownStore: MarkdownStore | null
}

// Load DomainCollection master schema
const dcSchemaPath = new URL('../../_shared-ts/models/DomainCollection/query/schema.graphql', import.meta.url).pathname
const dcSchema = readTextFileSync(dcSchemaPath)

/**
 * GraphQL type definitions for the notebook service.
 *
 * Base: DomainCollection master schema (schema.graphql) — all document types,
 * filter inputs, and rich queries (meetings, messages, people, orgs, etc.)
 *
 * Extensions: Legacy queries for VSCode autocomplete, score types, convenience
 * single-item lookups, and WebSocket subscriptions.
 */
export const typeDefs = `
${dcSchema}

type PersonWithScore {
  name: String!
  score: Float!
  lastInteraction: String
}

type OrgWithScore {
  name: String!
  score: Float!
  lastInteraction: String
}

type TagWithScore {
  name: String!
  score: Float!
  lastSeen: String
  fileCount: Int!
}

extend type Query {
  # Legacy queries (VSCode autocomplete — return string arrays)
  peopleNames: [String!]!
  projectNames: [String!]!
  tags: [String!]!
  organizations: [String!]!
  peopleWithScores: [PersonWithScore!]!
  organizationsWithScores: [OrgWithScore!]!
  tagsWithScores: [TagWithScore!]!

  # Convenience single-item lookups
  person(name: String!): Person
  org(name: String!): Org
  project(name: String!): Project

  # Convenience list-all queries
  allPeople: [Person!]!
  allOrgs: [Org!]!
  allProjects: [Project!]!

  # Ref resolution (for DocumentLinkProvider Cmd+Click)
  resolveRefs(refs: [String!]!, year: Int, month: Int, sourceFilePath: String): [ResolvedRef!]!
}

type ResolvedRef {
  ref: String!
  path: String
  type: String!
}

type Subscription {
  tagsUpdated: [String!]!
  peopleUpdated: [String!]!
  organizationsUpdated: [String!]!
  peopleWithScoresUpdated: [PersonWithScore!]!
  organizationsWithScoresUpdated: [OrgWithScore!]!
  tagsWithScoresUpdated: [TagWithScore!]!
}
`

/**
 * Interaction-score lookup for fuzzy person-name resolution, keyed by
 * normalized name. Rebuilt lazily so score updates flow through without
 * event wiring; scores shift slowly, so brief staleness is harmless.
 */
function createScoreLookup(store: Store): (name: string) => number {
  const TTL_MS = 60_000
  let cache: Map<string, number> | null = null
  let builtAt = 0

  return (name: string): number => {
    if (!cache || Date.now() - builtAt > TTL_MS) {
      cache = new Map()
      for (const p of store.getPeopleWithScores()) {
        const key = normalizeName(p.name)
        cache.set(key, (cache.get(key) ?? 0) + p.score)
      }
      builtAt = Date.now()
    }
    return cache.get(normalizeName(name)) ?? 0
  }
}

/**
 * Create GraphQL resolvers bound to store instances.
 */
export function createResolvers(store: Store, markdownStore: MarkdownStore | null) {
  // DomainCollection resolvers wrap a snapshot (a derived copy) of the
  // MarkdownStore. dcVersion records which store version the copy was built
  // from; liveDc() compares it to the live version on every read and rebuilds
  // on mismatch. Without that check, yoga served the boot-time scan for the
  // whole process lifetime — deleted files kept resolving, new files stayed
  // invisible until the next restart.
  //
  // Lazy compare-on-read beats the alternatives here:
  //  - an explicit reset call from the watcher is what silently failed
  //    before (it cleared executeQuery's cache, never this closure);
  //  - rebuilding eagerly on every file event wastes work — saves and sync
  //    touches fire constantly with no query in between;
  //  - rebuilding on every query pays fromStore() (~55ms on the production
  //    store) even when nothing changed, versus two integer reads.
  let dc: ReturnType<typeof createDomainResolvers> | null = null
  let dcVersion = -1
  const liveDc = () => {
    if (!markdownStore) return null
    if (!dc || dcVersion !== markdownStore.version) {
      dc = createDomainResolvers(markdownStore, { scoreFor: createScoreLookup(store) })
      dcVersion = markdownStore.version
    }
    return dc
  }

  // DomainCollection query delegation (DC resolvers take (args, gqlCtx, info);
  // createSchema passes (parent, args, ctx, info) — ctx/info forwarded so the
  // resolvers can report capped results into the request context, which the
  // truncation plugin then surfaces as response extensions. `satisfies` keeps
  // this map exhaustive over createDomainResolvers: a query added there
  // without a delegate here is a compile error. A missing delegate resolves
  // null, violates the non-null schema types ([Chat!]! etc.), and kills every
  // query touching the field.
  const dcDelegates = {
    meetings: (_: unknown, args: any, ctx: any, info: any) => liveDc()?.meetings(args, ctx, info) ?? [],
    messages: (_: unknown, args: any, ctx: any, info: any) => liveDc()?.messages(args, ctx, info) ?? [],
    videos: (_: unknown, args: any, ctx: any, info: any) => liveDc()?.videos(args, ctx, info) ?? [],
    recaps: (_: unknown, args: any, ctx: any, info: any) => liveDc()?.recaps(args, ctx, info) ?? [],
    people: (_: unknown, args: any, ctx: any, info: any) => liveDc()?.people(args, ctx, info) ?? [],
    orgs: (_: unknown, args: any, ctx: any, info: any) => liveDc()?.orgs(args, ctx, info) ?? [],
    projects: (_: unknown, args: any, ctx: any, info: any) => liveDc()?.projects(args, ctx, info) ?? [],
    decisions: (_: unknown, args: any, ctx: any, info: any) => liveDc()?.decisions(args, ctx, info) ?? [],
    goals: (_: unknown, args: any, ctx: any, info: any) => liveDc()?.goals(args, ctx, info) ?? [],
    streaks: (_: unknown, args: any, ctx: any, info: any) => liveDc()?.streaks(args, ctx, info) ?? [],
    places: (_: unknown, args: any, ctx: any, info: any) => liveDc()?.places(args, ctx, info) ?? [],
    ideas: (_: unknown, args: any, ctx: any, info: any) => liveDc()?.ideas(args, ctx, info) ?? [],
    days: (_: unknown, args: any, ctx: any, info: any) => liveDc()?.days(args, ctx, info) ?? [],
    journals: (_: unknown, args: any, ctx: any, info: any) => liveDc()?.journals(args, ctx, info) ?? [],
    chats: (_: unknown, args: any, ctx: any, info: any) => liveDc()?.chats(args, ctx, info) ?? [],
    documents: (_: unknown, args: any, ctx: any, info: any) => liveDc()?.documents(args, ctx, info) ?? [],
  } satisfies Record<keyof ReturnType<typeof createDomainResolvers>, unknown>

  return {
    Query: {
      // Legacy resolvers (string arrays for VSCode autocomplete)
      peopleNames: () => Array.from(store.people).toSorted(),
      projectNames: resolvers.projects,
      tags: () => Array.from(store.tags).toSorted(),
      organizations: () => Array.from(store.organizations).toSorted(),
      peopleWithScores: () => store.getPeopleWithScores(),
      organizationsWithScores: () => store.getOrganizationsWithScores(),
      tagsWithScores: () => store.getTagsWithScores(),

      // DomainCollection queries — exhaustiveness enforced on dcDelegates above
      ...dcDelegates,

      // Convenience single-item lookups
      person: (_: unknown, { name }: { name: string }) => {
        const results = liveDc()?.people({ where: { name } }) ?? []
        return results[0] ?? null
      },
      org: (_: unknown, { name }: { name: string }) => {
        const results = liveDc()?.orgs({ where: { name } }) ?? []
        return results[0] ?? null
      },
      project: (_: unknown, { name }: { name: string }) => {
        const results = liveDc()?.projects({ where: { name } }) ?? []
        return results[0] ?? null
      },

      // Convenience list-all queries
      allPeople: () => liveDc()?.people({}) ?? [],
      allOrgs: () => liveDc()?.orgs({}) ?? [],
      allProjects: () => liveDc()?.projects({}) ?? [],

      // Ref resolution
      resolveRefs: (_: unknown, args: { refs: string[]; year?: number; month?: number; sourceFilePath?: string }) => {
        if (!markdownStore) return []
        const context = {
          ...(args.year != null ? { year: args.year, month: args.month } : {}),
          ...(args.sourceFilePath ? { sourceFilePath: args.sourceFilePath } : {}),
        }
        return args.refs.map((ref) => {
          const resolved = markdownStore.resolve(ref, context)
          return {
            ref: resolved.raw,
            path: 'path' in resolved ? resolved.path : null,
            type: resolved.type,
          }
        })
      },
    },

    Subscription: {
      tagsUpdated: {
        subscribe: async function* () {
          while (true) {
            const tags = await new Promise((resolve) => {
              store.once('tagsUpdated', resolve)
            })
            yield { tagsUpdated: Array.from(tags as Iterable<string>).toSorted() }
          }
        },
      },
      peopleUpdated: {
        subscribe: async function* () {
          while (true) {
            const people = await new Promise((resolve) => {
              store.once('peopleUpdated', resolve)
            })
            yield { peopleUpdated: Array.from(people as Iterable<string>).toSorted() }
          }
        },
      },
      organizationsUpdated: {
        subscribe: async function* () {
          while (true) {
            const orgs = await new Promise((resolve) => {
              store.once('organizationsUpdated', resolve)
            })
            yield { organizationsUpdated: Array.from(orgs as Iterable<string>).toSorted() }
          }
        },
      },
      peopleWithScoresUpdated: {
        subscribe: async function* () {
          while (true) {
            const scores = await new Promise((resolve) => {
              store.once('personScoresUpdated', resolve)
            })
            yield { peopleWithScoresUpdated: scores }
          }
        },
      },
      organizationsWithScoresUpdated: {
        subscribe: async function* () {
          while (true) {
            const scores = await new Promise((resolve) => {
              store.once('orgScoresUpdated', resolve)
            })
            yield { organizationsWithScoresUpdated: scores }
          }
        },
      },
      tagsWithScoresUpdated: {
        subscribe: async function* () {
          while (true) {
            const scores = await new Promise((resolve) => {
              store.once('tagScoresUpdated', resolve)
            })
            yield { tagsWithScoresUpdated: scores }
          }
        },
      },
    },
  }
}

/**
 * Surface resolver-reported truncations as GraphQL response `extensions`.
 *
 * The resolvers push QueryTruncation records into the per-request context
 * (seeded here); a capped result is otherwise indistinguishable from a
 * complete one on the wire. `extensions` is the spec's side-channel for
 * exactly this — no schema change, invisible to consumers that ignore it.
 */
const truncationExtensionsPlugin = {
  onExecute({ args }: { args: { contextValue: Record<string, unknown> } }) {
    const truncations: unknown[] = []
    args.contextValue.truncations = truncations
    return {
      onExecuteDone({ result, setResult }: { result: unknown; setResult: (r: unknown) => void }) {
        if (truncations.length === 0) return
        // Incremental/stream results (subscriptions) have no single extensions object
        if (result && typeof result === 'object' && Symbol.asyncIterator in result) return
        const single = result as { extensions?: Record<string, unknown> }
        setResult({ ...single, extensions: { ...(single.extensions ?? {}), truncations } })
      },
    }
  },
}

/**
 * Create a GraphQL Yoga instance bound to specific stores.
 */
export function createYogaInstance(
  store: Store,
  markdownStore: MarkdownStore | null = null,
): YogaServerInstance<object, object> {
  return createYoga({
    graphqlEndpoint: '/graphql',
    schema: createSchema({
      typeDefs,
      resolvers: createResolvers(store, markdownStore),
    }),
    plugins: [truncationExtensionsPlugin],
    // Localhost single-user service: expose real resolver errors to clients.
    // Yoga's default masking rewrites them to "Unexpected error.", which made
    // ai:chat context failures undiagnosable from the CLI side.
    maskedErrors: false,
  })
}
