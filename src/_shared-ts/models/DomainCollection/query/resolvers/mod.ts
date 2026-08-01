/**
 * GraphQL resolvers for DomainCollection queries.
 *
 * These resolvers implement the schema.graphql types and can be used by:
 * - CLI tasks (markdown:sel) via direct execution
 * - Service (server) via graphql-yoga
 *
 * Each entity owns one module beside this one, holding its filter type, its
 * matcher, its document mapper and its resolver spec together. `shared.ts` holds
 * what they have in common — the repeated filter mixins, the field readers, the
 * Day index and the generic list resolver. Adding an entity is a new file plus
 * one line in the object returned below.
 */

import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import DomainCollection from '../../mod.ts'
import { createNameResolver } from '../nameResolver.ts'
import { type ResolverContext, createDayLookup, getDateForDocument, listResolver } from './shared.ts'
import chat from './chat.ts'
import day from './day.ts'
import decision from './decision.ts'
import document from './document.ts'
import goal from './goal.ts'
import idea from './idea.ts'
import journal from './journal.ts'
import meeting from './meeting.ts'
import message from './message.ts'
import org from './org.ts'
import person from './person.ts'
import place from './place.ts'
import project from './project.ts'
import streak from './streak.ts'
import video from './video.ts'

// Filter types (match schema.graphql inputs), re-exported so callers keep a
// single import site for the query layer's contract.
export type { ChatFilter } from './chat.ts'
export type { DayFilter } from './day.ts'
export type { DecisionFilter } from './decision.ts'
export type { DocumentFilter } from './document.ts'
export type { GoalFilter } from './goal.ts'
export type { IdeaFilter } from './idea.ts'
export type { JournalFilter } from './journal.ts'
export type { MeetingFilter } from './meeting.ts'
export type { MessageFilter } from './message.ts'
export type { OrgFilter } from './org.ts'
export type { PersonFilter } from './person.ts'
export type { PlaceFilter } from './place.ts'
export type { ProjectFilter } from './project.ts'
export type { StreakFilter } from './streak.ts'
export type { VideoFilter } from './video.ts'

export interface DomainResolverOptions {
  /**
   * Interaction-score lookup for fuzzy person-name resolution (raw name in,
   * score out). The notebook service supplies this from its ScoringStore so
   * informal references ("James") resolve to the most-interacted-with match.
   */
  scoreFor?: (name: string) => number
}

/**
 * Create GraphQL resolvers for DomainCollection queries.
 *
 * Note: These use the buildSchema + rootValue signature where functions
 * receive (args, context, info) directly, NOT (parent, args, context, info).
 */
export function createDomainResolvers(store: MarkdownStore, options: DomainResolverOptions = {}) {
  const domain = DomainCollection.fromStore(store)

  // Day index for resolving meeting.day, message.day, journal.day, ...
  const lookupDay = createDayLookup(domain)

  const ctx: ResolverContext = {
    domain,
    // Resolve a name to all known aliases via PeopleStore, with token + score
    // fallback for informal references. e.g., "JW" → ["James Robert Wheeler",
    // "JW", "Jim Wheeler"]; "James" → the highest-scored James's names.
    resolveNames: createNameResolver(store.people, { scoreFor: options.scoreFor }),
    dayFor(doc, path) {
      const dateStr = getDateForDocument(doc, path)
      return dateStr ? lookupDay(dateStr) : null
    },
  }

  return {
    meetings: listResolver(meeting, ctx),
    messages: listResolver(message, ctx),
    videos: listResolver(video, ctx),
    people: listResolver(person, ctx),
    orgs: listResolver(org, ctx),
    projects: listResolver(project, ctx),
    decisions: listResolver(decision, ctx),
    goals: listResolver(goal, ctx),
    ideas: listResolver(idea, ctx),
    streaks: listResolver(streak, ctx),
    places: listResolver(place, ctx),
    days: listResolver(day, ctx),
    journals: listResolver(journal, ctx),
    chats: listResolver(chat, ctx),
    documents: listResolver(document, ctx),
  }
}
