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
import type { Store } from '../store.ts'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { createDomainResolvers } from '#shared/models/DomainCollection/query/resolvers.ts'
import { normalizeName } from '#shared/models/Store/normalize.ts'
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
  // Create DomainCollection resolvers when MarkdownStore is available
  const dc = markdownStore ? createDomainResolvers(markdownStore, { scoreFor: createScoreLookup(store) }) : null

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

      // DomainCollection queries (DC uses (args), createSchema uses (_parent, args))
      meetings: (_: unknown, args: any) => dc?.meetings(args) ?? [],
      messages: (_: unknown, args: any) => dc?.messages(args) ?? [],
      videos: (_: unknown, args: any) => dc?.videos(args) ?? [],
      people: (_: unknown, args: any) => dc?.people(args) ?? [],
      orgs: (_: unknown, args: any) => dc?.orgs(args) ?? [],
      projects: (_: unknown, args: any) => dc?.projects(args) ?? [],
      decisions: (_: unknown, args: any) => dc?.decisions(args) ?? [],
      goals: (_: unknown, args: any) => dc?.goals(args) ?? [],
      places: (_: unknown, args: any) => dc?.places(args) ?? [],
      ideas: (_: unknown, args: any) => dc?.ideas(args) ?? [],
      days: (_: unknown, args: any) => dc?.days(args) ?? [],
      journals: (_: unknown, args: any) => dc?.journals(args) ?? [],
      chats: (_: unknown, args: any) => dc?.chats(args) ?? [],
      documents: (_: unknown, args: any) => dc?.documents(args) ?? [],

      // Convenience single-item lookups
      person: (_: unknown, { name }: { name: string }) => {
        const results = dc?.people({ where: { name } }) ?? []
        return results[0] ?? null
      },
      org: (_: unknown, { name }: { name: string }) => {
        const results = dc?.orgs({ where: { name } }) ?? []
        return results[0] ?? null
      },
      project: (_: unknown, { name }: { name: string }) => {
        const results = dc?.projects({ where: { name } }) ?? []
        return results[0] ?? null
      },

      // Convenience list-all queries
      allPeople: () => dc?.people({}) ?? [],
      allOrgs: () => dc?.orgs({}) ?? [],
      allProjects: () => dc?.projects({}) ?? [],

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
  })
}
