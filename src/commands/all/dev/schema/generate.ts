/**
 * Generate GraphQL schema from document models.
 *
 * Usage: sky dev:schema:generate
 *
 * Outputs to: _shared-ts/models/DomainCollection/query/schema.graphql
 */

import { Command, CommandResult } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription } from '#commands/mod.ts'
import { writeTextFile } from '#shared/fs/mod.ts'

// -----------------------------------------------------------------------------
// Schema Definition (derived from document models)
// -----------------------------------------------------------------------------

interface FieldDef {
  type: string
  description?: string
  nullable?: boolean
}

interface TypeDef {
  description?: string
  fields: Record<string, FieldDef>
}

interface FilterDef {
  description?: string
  fields: Record<string, string>
}

// Shared value types (not documents in their own right)
const VALUE_TYPES: Record<string, TypeDef> = {
  When: {
    description: 'A point in time with an optional length. End is derived, never stored.',
    fields: {
      datetime: { type: 'String!', description: 'YYYY-MM-DD HH:MM (hours may exceed 24 for late nights)' },
      duration: { type: 'String', description: 'Length as an ms-style string, e.g. "70m"', nullable: true },
      durationMinutes: { type: 'Int', description: 'Length in whole minutes', nullable: true },
      end: { type: 'String', description: 'Derived end time, YYYY-MM-DD HH:MM', nullable: true },
    },
  },
}

// Document types derived from _shared-ts/models/*/document/mod.ts
const DOCUMENT_TYPES: Record<string, TypeDef> = {
  Meeting: {
    description: 'Meeting notes with attendees and outcomes',
    fields: {
      who: { type: 'String', description: 'Attendees (comma-separated names)' },
      when: { type: 'When', description: 'When it happened, with optional duration', nullable: true },
      medium: { type: 'String', description: 'Meeting type: Zoom, Phone, In Person, etc.' },
      context: { type: 'String', description: 'Context or purpose', nullable: true },
      summary: { type: 'String', description: 'Brief summary', nullable: true },
      where: { type: 'String', description: 'Location (for in-person)', nullable: true },
      date: { type: 'String!', description: 'Date (YYYY-MM-DD)' },
      day: { type: 'Day', description: 'The day this meeting occurred on', nullable: true },
      tags: { type: '[String!]!', description: 'Tags' },
      rel: { type: '[String!]!', description: 'Related entities' },
      markdown: { type: 'String!', description: 'Full document content' },
      path: { type: 'String!', description: 'File path' },
    },
  },
  Video: {
    description: 'Video recording with transcript and summary',
    fields: {
      from: { type: 'String', description: 'Presenter/creator', nullable: true },
      to: {
        type: 'String',
        description: 'Intended audience: person name(s), or "#channel-name" for videos posted to a Slack channel',
        nullable: true,
      },
      when: { type: 'When', description: 'When it happened, with optional duration', nullable: true },
      medium: { type: 'String', description: 'Video platform: Video, Loom, YouTube, etc.' },
      summary: { type: 'String', description: 'Brief summary', nullable: true },
      url: { type: 'String', description: 'Video URL', nullable: true },
      date: { type: 'String!', description: 'Date (YYYY-MM-DD)' },
      day: { type: 'Day', description: 'The day this video was recorded on', nullable: true },
      tags: { type: '[String!]!', description: 'Tags' },
      rel: { type: '[String!]!', description: 'Related entities' },
      markdown: { type: 'String!', description: 'Full document content' },
      path: { type: 'String!', description: 'File path' },
    },
  },
  Recap: {
    description: 'Daily recap of activity in a connected app (GitHub, Claude Code, ...)',
    fields: {
      app: { type: 'String!', description: 'Connected app the recap digests: github, claude-code, etc.' },
      what: { type: 'String!', description: 'Human label, e.g. "Code - GitHub"' },
      when: { type: 'When', description: 'First-to-last activity span (never a length)', nullable: true },
      date: { type: 'String!', description: 'Date (YYYY-MM-DD)' },
      day: { type: 'Day', description: 'The day this recap belongs to', nullable: true },
      tags: { type: '[String!]!', description: 'Tags' },
      rel: { type: '[String!]!', description: 'Related entities' },
      markdown: { type: 'String!', description: 'Full document content' },
      path: { type: 'String!', description: 'File path' },
    },
  },
  Message: {
    description: 'Messages from Slack, email, text, etc.',
    fields: {
      from: { type: 'String', description: 'Sender name', nullable: true },
      to: {
        type: 'String',
        description: 'Recipient(s): person name(s), or "#channel-name" for Slack channel messages',
        nullable: true,
      },
      when: { type: 'When', description: 'When it happened, with optional duration', nullable: true },
      medium: { type: 'String', description: 'Platform: Slack, Email, iMessage, etc.' },
      summary: { type: 'String', description: 'Brief summary', nullable: true },
      date: { type: 'String!', description: 'Date (YYYY-MM-DD)' },
      day: { type: 'Day', description: 'The day this message was sent on', nullable: true },
      tags: { type: '[String!]!', description: 'Tags' },
      rel: { type: '[String!]!', description: 'Related entities' },
      markdown: { type: 'String!', description: 'Full document content' },
      path: { type: 'String!', description: 'File path' },
    },
  },
  Person: {
    description: 'Contact/person record',
    fields: {
      name: { type: 'String!', description: 'Primary name' },
      names: { type: '[String!]!', description: 'All known names/aliases' },
      org: { type: 'String', description: 'Primary current organization', nullable: true },
      orgs: { type: 'PersonOrgs!', description: 'Current and past organizations' },
      title: { type: 'String', description: 'Job title', nullable: true },
      location: { type: 'String', description: 'Location', nullable: true },
      met: { type: 'String', description: 'When first met (date or year)', nullable: true },
      tags: { type: '[String!]!', description: 'Tags' },
      rel: { type: '[String!]!', description: 'Related entities' },
      markdown: { type: 'String!', description: 'Full document content' },
      path: { type: 'String!', description: 'File path' },
    },
  },
  Org: {
    description: 'Organization/company record',
    fields: {
      name: { type: 'String!', description: 'Organization name' },
      slug: { type: 'String', description: 'URL-friendly identifier', nullable: true },
      site: { type: 'String', description: 'Website URL', nullable: true },
      sector: { type: 'String', description: 'Industry sector', nullable: true },
      subcategory: { type: 'String', description: 'Subcategory', nullable: true },
      description: { type: 'String', description: 'Brief description', nullable: true },
      kind: { type: 'String', description: 'Type: company, government, nonprofit' },
      tags: { type: '[String!]!', description: 'Tags' },
      rel: { type: '[String!]!', description: 'Related entities' },
      markdown: { type: 'String!', description: 'Full document content' },
      path: { type: 'String!', description: 'File path' },
    },
  },
  Project: {
    description: 'Project with status tracking',
    fields: {
      name: { type: 'String!', description: 'Project name' },
      status: { type: 'String!', description: 'Status: open, hold, completed, canceled, whiteboard' },
      closedReason: { type: 'String', description: 'Reason for closure', nullable: true },
      tags: { type: '[String!]!', description: 'Tags' },
      rel: { type: '[String!]!', description: 'Related entities' },
      markdown: { type: 'String!', description: 'Full document content' },
      path: { type: 'String!', description: 'File path' },
      files: { type: '[String!]!', description: 'Paths of other markdown files in the project folder' },
    },
  },
  Decision: {
    description: 'Decision record with pending/resolved status',
    fields: {
      name: { type: 'String!', description: 'Decision identifier/slug' },
      summary: { type: 'String', description: 'Human-readable summary', nullable: true },
      identified: { type: 'String', description: 'When identified (ISO datetime)', nullable: true },
      target: { type: 'String', description: 'Target decision date', nullable: true },
      resolved: { type: 'String', description: 'When resolved (null if pending)', nullable: true },
      isPending: { type: 'Boolean!', description: 'True if not yet resolved' },
      tags: { type: '[String!]!', description: 'Tags' },
      rel: { type: '[String!]!', description: 'Related entities' },
      markdown: { type: 'String!', description: 'Full document content' },
      path: { type: 'String!', description: 'File path' },
    },
  },
  Goal: {
    description: 'Goal/objective',
    fields: {
      name: { type: 'String!', description: 'Goal name' },
      status: { type: 'String', description: 'Goal status', nullable: true },
      tags: { type: '[String!]!', description: 'Tags' },
      rel: { type: '[String!]!', description: 'Related entities' },
      markdown: { type: 'String!', description: 'Full document content' },
      path: { type: 'String!', description: 'File path' },
    },
  },
  Place: {
    description: 'Place/location record',
    fields: {
      name: { type: 'String!', description: 'Place name' },
      type: { type: 'String!', description: 'Place type: eat, drink, stay, visit, etc.' },
      address: { type: 'String', description: 'Full address', nullable: true },
      site: { type: 'String', description: 'Website URL', nullable: true },
      googleMapsUrl: { type: 'String', description: 'Google Maps URL', nullable: true },
      country: { type: 'String', description: 'Country code', nullable: true },
      city: { type: 'String', description: 'City name', nullable: true },
      tags: { type: '[String!]!', description: 'Tags' },
      rel: { type: '[String!]!', description: 'Related entities' },
      markdown: { type: 'String!', description: 'Full document content' },
      path: { type: 'String!', description: 'File path' },
    },
  },
  Idea: {
    description: 'Idea with lifecycle tracking (draft/exploring/actioned/archived)',
    fields: {
      name: { type: 'String!', description: 'Idea identifier/slug' },
      status: { type: 'String!', description: 'Status: draft, exploring, actioned, archived (derived from path)' },
      tags: { type: '[String!]!', description: 'Tags' },
      rel: { type: '[String!]!', description: 'Related entities' },
      markdown: { type: 'String!', description: 'Full document content' },
      path: { type: 'String!', description: 'File path' },
    },
  },
  Streak: {
    description: 'Habit-tracking streak rule with computed run statistics (active/archived)',
    fields: {
      name: { type: 'String!', description: 'Streak identifier/slug' },
      title: { type: 'String!', description: 'Human title shown in day-file Streaks lists' },
      status: { type: 'String!', description: 'Status: active, archived (derived from path)' },
      schedule: { type: 'String!', description: 'Cadence: daily, weekdays' },
      start: { type: 'String', description: 'First tracked day (YYYY-MM-DD)', nullable: true },
      end: {
        type: 'String',
        description: 'Last tracked day, inclusive; a future value is a planned end',
        nullable: true,
      },
      current: { type: 'Int!', description: 'Current run in completed days (computed from day files)' },
      best: { type: 'Int!', description: 'Longest run ever (computed)' },
      trackedToday: { type: 'Boolean!', description: 'Whether today expects this streak' },
      completedToday: { type: 'Boolean!', description: 'Whether today is already struck' },
      monthDone: { type: 'Int!', description: 'Completions this month (through yesterday, plus today once done)' },
      monthTracked: { type: 'Int!', description: 'Tracked days this month — the consistency denominator' },
      lastDone: { type: 'String', description: 'Most recent completed day (YYYY-MM-DD)', nullable: true },
      tags: { type: '[String!]!', description: 'Tags' },
      rel: { type: '[String!]!', description: 'Related entities' },
      markdown: { type: 'String!', description: 'Full document content (the why)' },
      path: { type: 'String!', description: 'File path' },
    },
  },
  Day: {
    description: 'Daily note/log',
    fields: {
      date: { type: 'String!', description: 'Date (YYYY-MM-DD)' },
      year: { type: 'Int!', description: 'Year' },
      month: { type: 'Int!', description: 'Month (1-12)' },
      started: { type: 'String', description: 'Day start time', nullable: true },
      ended: { type: 'String', description: 'Day end time', nullable: true },
      location: { type: 'String', description: 'Location', nullable: true },
      tz: { type: 'String', description: 'Timezone', nullable: true },
      streaksCompleted: { type: '[String!]!', description: 'Streak slugs struck done on this day' },
      streaksMissed: { type: '[String!]!', description: 'Streak slugs tracked this day but not struck' },
      tags: { type: '[String!]!', description: 'Tags' },
      markdown: { type: 'String!', description: 'Full document content' },
      path: { type: 'String!', description: 'File path' },
    },
  },
  Journal: {
    description: 'Journal entry',
    fields: {
      date: { type: 'String!', description: 'Date (YYYY-MM-DD)' },
      day: { type: 'Day', description: 'The day this journal entry was written on', nullable: true },
      time: { type: 'String', description: 'Time (HH:MM)', nullable: true },
      tags: { type: '[String!]!', description: 'Tags' },
      rel: { type: '[String!]!', description: 'Related entities' },
      markdown: { type: 'String!', description: 'Full document content' },
      path: { type: 'String!', description: 'File path' },
    },
  },
  Chat: {
    description: 'Saved AI chat conversation (ai:chat transcript)',
    fields: {
      date: { type: 'String!', description: 'Date (YYYY-MM-DD)' },
      day: { type: 'Day', description: 'The day this chat happened on', nullable: true },
      when: { type: 'String', description: 'Start time from the filename (HH:MM)', nullable: true },
      summary: { type: 'String', description: 'Conversation summary', nullable: true },
      provider: { type: 'String', description: 'AI provider (claude, openai, etc.)', nullable: true },
      model: { type: 'String', description: 'Model name', nullable: true },
      turns: { type: 'Int!', description: 'Number of conversation turns' },
      tags: { type: '[String!]!', description: 'Tags' },
      rel: { type: '[String!]!', description: 'Related entities' },
      markdown: { type: 'String!', description: 'Full conversation transcript' },
      path: { type: 'String!', description: 'File path' },
    },
  },
}

// Auxiliary types (nested objects)
const AUXILIARY_TYPES: Record<string, TypeDef> = {
  PersonOrgs: {
    description: 'Current and past organizations for a person',
    fields: {
      current: { type: '[String!]!', description: 'Current organizations' },
      past: { type: '[String!]!', description: 'Past organizations' },
    },
  },
}

// Filter inputs for each type
const FILTER_TYPES: Record<string, FilterDef> = {
  MeetingFilter: {
    fields: {
      date: 'String',
      dateGte: 'String',
      dateLte: 'String',
      recent: 'String',
      year: 'Int',
      month: 'Int',
      whoContains: 'String',
      whoNotContains: 'String',
      medium: 'String',
      tagsContains: 'String',
      tagsContainsAny: '[String!]',
      tagsContainsAll: '[String!]',
      tagsStartsWith: 'String',
      tagsNotContains: 'String',
      bodyContains: 'String',
      involves: 'String',
      involvesAny: '[String!]',
      involvesAll: '[String!]',
      relContains: 'String',
    },
  },
  VideoFilter: {
    fields: {
      date: 'String',
      dateGte: 'String',
      dateLte: 'String',
      recent: 'String',
      from: 'String',
      fromNot: 'String',
      fromContains: 'String',
      to: 'String',
      toNot: 'String',
      toContains: 'String',
      toNotContains: 'String',
      medium: 'String',
      summaryContains: 'String',
      tagsContains: 'String',
      tagsContainsAny: '[String!]',
      tagsContainsAll: '[String!]',
      tagsStartsWith: 'String',
      bodyContains: 'String',
      involves: 'String',
      involvesAny: '[String!]',
      involvesAll: '[String!]',
      relContains: 'String',
    },
  },
  RecapFilter: {
    fields: {
      date: 'String',
      dateGte: 'String',
      dateLte: 'String',
      recent: 'String',
      app: 'String',
      appNot: 'String',
      whatContains: 'String',
      tagsContains: 'String',
      tagsContainsAny: '[String!]',
      tagsContainsAll: '[String!]',
      tagsStartsWith: 'String',
      bodyContains: 'String',
      relContains: 'String',
    },
  },
  MessageFilter: {
    fields: {
      date: 'String',
      dateGte: 'String',
      dateLte: 'String',
      recent: 'String',
      from: 'String',
      fromNot: 'String',
      toContains: 'String',
      toNotContains: 'String',
      medium: 'String',
      tagsContains: 'String',
      tagsContainsAny: '[String!]',
      tagsContainsAll: '[String!]',
      tagsStartsWith: 'String',
      bodyContains: 'String',
      involves: 'String',
      involvesAny: '[String!]',
      involvesAll: '[String!]',
      relContains: 'String',
    },
  },
  PersonFilter: {
    fields: {
      name: 'String',
      nameContains: 'String',
      org: 'String',
      orgContains: 'String',
      titleContains: 'String',
      tagsContains: 'String',
      tagsContainsAny: '[String!]',
      tagsContainsAll: '[String!]',
      tagsStartsWith: 'String',
      relContains: 'String',
      bodyContains: 'String',
      recent: 'String',
      createdRecently: 'String',
      updatedRecently: 'String',
    },
  },
  OrgFilter: {
    fields: {
      name: 'String',
      nameContains: 'String',
      sector: 'String',
      kind: 'String',
      tagsContains: 'String',
      tagsContainsAny: '[String!]',
      tagsContainsAll: '[String!]',
      tagsStartsWith: 'String',
      relContains: 'String',
      bodyContains: 'String',
      recent: 'String',
      createdRecently: 'String',
      updatedRecently: 'String',
    },
  },
  ProjectFilter: {
    fields: {
      name: 'String',
      nameContains: 'String',
      status: 'String',
      tagsContains: 'String',
      tagsContainsAny: '[String!]',
      tagsContainsAll: '[String!]',
      tagsStartsWith: 'String',
      involves: 'String',
      involvesAny: '[String!]',
      involvesAll: '[String!]',
      relContains: 'String',
      bodyContains: 'String',
      recent: 'String',
      createdRecently: 'String',
      updatedRecently: 'String',
    },
  },
  DecisionFilter: {
    fields: {
      nameContains: 'String',
      pending: 'Boolean',
      decided: 'Boolean',
      identifiedGte: 'String',
      identifiedLte: 'String',
      tagsContains: 'String',
      tagsContainsAny: '[String!]',
      tagsContainsAll: '[String!]',
      tagsStartsWith: 'String',
      involves: 'String',
      involvesAny: '[String!]',
      involvesAll: '[String!]',
      relContains: 'String',
      bodyContains: 'String',
      recent: 'String',
      createdRecently: 'String',
      updatedRecently: 'String',
    },
  },
  GoalFilter: {
    fields: {
      nameContains: 'String',
      status: 'String',
      tagsContains: 'String',
      tagsContainsAny: '[String!]',
      tagsContainsAll: '[String!]',
      tagsStartsWith: 'String',
      involves: 'String',
      involvesAny: '[String!]',
      involvesAll: '[String!]',
      relContains: 'String',
      bodyContains: 'String',
      recent: 'String',
      createdRecently: 'String',
      updatedRecently: 'String',
    },
  },
  IdeaFilter: {
    fields: {
      nameContains: 'String',
      status: 'String',
      tagsContains: 'String',
      tagsContainsAny: '[String!]',
      tagsContainsAll: '[String!]',
      tagsStartsWith: 'String',
      involves: 'String',
      involvesAny: '[String!]',
      involvesAll: '[String!]',
      relContains: 'String',
      bodyContains: 'String',
      recent: 'String',
      createdRecently: 'String',
      updatedRecently: 'String',
    },
  },
  StreakFilter: {
    fields: {
      name: 'String',
      nameContains: 'String',
      titleContains: 'String',
      status: 'String',
      schedule: 'String',
      tagsContains: 'String',
      tagsContainsAny: '[String!]',
      tagsContainsAll: '[String!]',
      tagsStartsWith: 'String',
      relContains: 'String',
      bodyContains: 'String',
    },
  },
  PlaceFilter: {
    fields: {
      nameContains: 'String',
      type: 'String',
      country: 'String',
      cityContains: 'String',
      tagsContains: 'String',
      tagsContainsAny: '[String!]',
      tagsContainsAll: '[String!]',
      tagsStartsWith: 'String',
      relContains: 'String',
      bodyContains: 'String',
      recent: 'String',
      createdRecently: 'String',
      updatedRecently: 'String',
    },
  },
  DayFilter: {
    fields: {
      date: 'String',
      dateGte: 'String',
      dateLte: 'String',
      recent: 'String',
      year: 'Int',
      month: 'Int',
      tagsContains: 'String',
      tagsContainsAny: '[String!]',
      tagsContainsAll: '[String!]',
      tagsStartsWith: 'String',
    },
  },
  JournalFilter: {
    fields: {
      date: 'String',
      dateGte: 'String',
      dateLte: 'String',
      recent: 'String',
      tagsContains: 'String',
      tagsContainsAny: '[String!]',
      tagsContainsAll: '[String!]',
      tagsStartsWith: 'String',
      bodyContains: 'String',
      involves: 'String',
      involvesAny: '[String!]',
      involvesAll: '[String!]',
      relContains: 'String',
    },
  },
  ChatFilter: {
    fields: {
      date: 'String',
      dateGte: 'String',
      dateLte: 'String',
      recent: 'String',
      summaryContains: 'String',
      tagsContains: 'String',
      tagsContainsAny: '[String!]',
      tagsContainsAll: '[String!]',
      tagsStartsWith: 'String',
      bodyContains: 'String',
      involves: 'String',
      involvesAny: '[String!]',
      involvesAll: '[String!]',
      relContains: 'String',
    },
  },
  DocumentFilter: {
    description: 'Filter for querying across all document types',
    fields: {
      date: 'String',
      dateGte: 'String',
      dateLte: 'String',
      type: 'String',
      pathContains: 'String',
      involves: 'String',
      involvesAny: '[String!]',
      involvesAll: '[String!]',
      tagsContains: 'String',
      tagsContainsAny: '[String!]',
      tagsContainsAll: '[String!]',
      tagsStartsWith: 'String',
      bodyContains: 'String',
      recent: 'String',
      relContains: 'String',
    },
  },
}

// -----------------------------------------------------------------------------
// Schema Generation
// -----------------------------------------------------------------------------

function generateSchema(): string {
  const lines: string[] = []

  // Header
  lines.push('# ' + '='.repeat(77))
  lines.push('# DO NOT EDIT THIS FILE DIRECTLY!')
  lines.push('# ' + '='.repeat(77))
  lines.push('#')
  lines.push('# This file is auto-generated by: sky dev:schema:generate')
  lines.push('# Source of truth: src/commands/all/dev/schema/generate.ts')
  lines.push('#')
  lines.push('# To modify the schema, edit generate.ts and re-run the generator.')
  lines.push('#')
  lines.push(`# Generated at: ${new Date().toISOString()}`)
  lines.push('# ' + '='.repeat(77))
  lines.push('')

  // Query type
  lines.push('type Query {')
  lines.push('  # Document queries')
  for (const typeName of Object.keys(DOCUMENT_TYPES)) {
    const pluralName = pluralize(typeName)
    const filterName = `${typeName}Filter`
    lines.push(`  ${pluralName}(where: ${filterName}, limit: Int): [${typeName}!]!`)
  }
  lines.push('')
  lines.push('  # Generic query across all document types')
  lines.push('  documents(where: DocumentFilter, limit: Int): [Document!]!')
  lines.push('}')
  lines.push('')

  // Separator
  lines.push('# ' + '='.repeat(77))
  lines.push('# Document Types')
  lines.push('# ' + '='.repeat(77))
  lines.push('')

  // Value types and document types share one emitter — a value type is just a
  // type the documents point at rather than one a root field returns.
  for (const [typeName, typeDef] of Object.entries({ ...VALUE_TYPES, ...DOCUMENT_TYPES })) {
    if (typeDef.description) {
      lines.push('"""', typeDef.description, '"""')
    }
    lines.push(`type ${typeName} {`)
    for (const [fieldName, fieldDef] of Object.entries(typeDef.fields)) {
      const typeStr = fieldDef.nullable ? fieldDef.type : fieldDef.type.replace(/!$/, '') + '!'
      const desc = fieldDef.description ? ` # ${fieldDef.description}` : ''
      // Make nullable fields not have !
      const finalType = fieldDef.nullable ? fieldDef.type.replace(/!$/, '') : typeStr
      lines.push(`  ${fieldName}: ${finalType}${desc}`)
    }
    lines.push('}')
    lines.push('')
  }

  // Generic Document type
  lines.push('"""', 'Generic document for cross-type queries', '"""')
  lines.push('type Document {')
  lines.push('  type: String! # Document type: meeting, message, person, etc.')
  lines.push('  markdown: String! # Full document content')
  lines.push('  path: String! # File path')
  lines.push('}')
  lines.push('')

  // Auxiliary types (nested objects)
  if (Object.keys(AUXILIARY_TYPES).length > 0) {
    lines.push('# ' + '='.repeat(77))
    lines.push('# Auxiliary Types')
    lines.push('# ' + '='.repeat(77))
    lines.push('')

    for (const [typeName, typeDef] of Object.entries(AUXILIARY_TYPES)) {
      if (typeDef.description) {
        lines.push('"""', typeDef.description, '"""')
      }
      lines.push(`type ${typeName} {`)
      for (const [fieldName, fieldDef] of Object.entries(typeDef.fields)) {
        const typeStr = fieldDef.nullable ? fieldDef.type : fieldDef.type.replace(/!$/, '') + '!'
        const desc = fieldDef.description ? ` # ${fieldDef.description}` : ''
        const finalType = fieldDef.nullable ? fieldDef.type.replace(/!$/, '') : typeStr
        lines.push(`  ${fieldName}: ${finalType}${desc}`)
      }
      lines.push('}')
      lines.push('')
    }
  }

  // Separator
  lines.push('# ' + '='.repeat(77))
  lines.push('# Filter Inputs')
  lines.push('# ' + '='.repeat(77))
  lines.push('')

  // Filter types
  for (const [filterName, filterDef] of Object.entries(FILTER_TYPES)) {
    if (filterDef.description) {
      lines.push('"""', filterDef.description, '"""')
    }
    lines.push(`input ${filterName} {`)
    for (const [fieldName, fieldType] of Object.entries(filterDef.fields)) {
      lines.push(`  ${fieldName}: ${fieldType}`)
    }
    lines.push('}')
    lines.push('')
  }

  return lines.join('\n')
}

function pluralize(typeName: string): string {
  switch (typeName) {
    case 'Person':
      return 'people'
    case 'Day':
      return 'days'
    default:
      return typeName.toLowerCase() + 's'
  }
}

// -----------------------------------------------------------------------------
// Output path
// -----------------------------------------------------------------------------

const OUTPUT_PATH = new URL('../../../../_shared-ts/models/DomainCollection/query/schema.graphql', import.meta.url)
  .pathname

// -----------------------------------------------------------------------------
// Command
// -----------------------------------------------------------------------------

export default class DevGenerateSchemaTask extends Command {
  static override description: CommandDescription = {
    name: 'dev:schema:generate',
    description: 'Generate GraphQL schema from document models',
    descriptionLong: [
      'Generates a GraphQL schema file from the document model definitions.',
      '',
      'Output: _shared-ts/models/DomainCollection/query/schema.graphql',
      '',
      'The schema is derived from the typed accessors in each document class:',
      '- Meeting, Video, Recap, Message, Person, Org, Project, Decision, Goal, Day, Journal, Chat',
    ],
    usage: ['sky dev:schema:generate'],
  }

  async run({ context }: CommandArgs): Promise<CommandResult> {
    const { output } = context

    output.log('Generating GraphQL schema from document models...')

    const schema = generateSchema()

    await writeTextFile(OUTPUT_PATH, schema)

    output.log(`Written to: ${OUTPUT_PATH}`)
    output.log(`Generated ${Object.keys(DOCUMENT_TYPES).length} types and ${Object.keys(FILTER_TYPES).length} filters`)

    return CommandResult.success()
  }
}
