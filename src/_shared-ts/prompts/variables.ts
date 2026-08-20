import type { VariableDefinition } from './types.ts'

/**
 * Reserved namespaces with their field definitions.
 * Reserved namespaces have known fields that generate warnings if unknown.
 */
export const RESERVED_NAMESPACES = {
  global: {
    userName: {
      type: 'string' as const,
      description: "User's display name",
    },
    userCompany: {
      type: 'string' as const,
      description: "User's company name",
    },
  },
  me: {
    firstName: {
      type: 'string' as const,
      description: "User's first name",
    },
    lastName: {
      type: 'string' as const,
      description: "User's last name",
    },
    fullName: {
      type: 'string' as const,
      description: "User's full name (first + last)",
    },
    location: {
      type: 'string' as const,
      description: "User's location (city, state/country)",
    },
    family: {
      type: 'string' as const,
      description: "User's family description",
    },
    company: {
      type: 'string' as const,
      description: "User's company name",
    },
    title: {
      type: 'string' as const,
      description: "User's job title",
    },
    companyDescription: {
      type: 'string' as const,
      description: "Description of user's company",
    },
    communicationStyle: {
      type: 'string' as const,
      description: "User's communication style preferences",
    },
    decisionMaking: {
      type: 'string' as const,
      description: "User's decision-making approach",
    },
    technicalContext: {
      type: 'string' as const,
      description: "User's technical context (languages, tools, platforms)",
    },
    bio: {
      type: 'string' as const,
      description: "User's generated bio summary",
    },
  },
  prompt: {
    name: {
      type: 'string' as const,
      description: 'File slug (e.g., "journal-questions")',
    },
    description: {
      type: 'string' as const,
      description: 'Description from frontmatter',
    },
    created: {
      type: 'string' as const,
      description: 'Creation date from frontmatter (YYYY-MM-DD)',
    },
    updated: {
      type: 'string' as const,
      description: 'Last updated date from frontmatter (YYYY-MM-DD)',
    },
  },
  context: {
    notebookDate: {
      type: 'string' as const,
      description: 'Current notebook date (YYYY-MM-DD)',
    },
    notebookDay: {
      type: 'string' as const,
      description: 'Weekday of the notebook date (e.g., "Thursday") - derived from notebookDate',
    },
    notebookTime: {
      type: 'string' as const,
      description: 'Current notebook time (HH:MM)',
    },
    systemDate: {
      type: 'string' as const,
      description: 'System/wall-clock date (YYYY-MM-DD)',
    },
    systemTime: {
      type: 'string' as const,
      description: 'System/wall-clock time (HH:MM)',
    },
    notebookTimezone: {
      type: 'string' as const,
      description: 'Notebook timezone (e.g., "America/New_York")',
    },
    systemTimezone: {
      type: 'string' as const,
      description: 'System timezone (e.g., "America/New_York")',
    },
  },
  user: {
    input: {
      type: 'string' as const,
      description: 'User-supplied input to be processed by the template',
    },
  },
} as const

export type ReservedNamespace = keyof typeof RESERVED_NAMESPACES

/**
 * Check if a namespace is reserved (has known field definitions)
 */
export function isReservedNamespace(namespace: string): namespace is ReservedNamespace {
  return namespace in RESERVED_NAMESPACES
}

/**
 * Get field definition from a reserved namespace
 */
export function getReservedFieldDefinition(
  namespace: ReservedNamespace,
  field: string,
): VariableDefinition | undefined {
  const ns = RESERVED_NAMESPACES[namespace] as Record<string, VariableDefinition>
  return ns[field]
}

/**
 * Get all variable names in namespace.field format for autocomplete
 */
export function getAllVariableNames(): string[] {
  const names: string[] = []

  for (const [namespace, fields] of Object.entries(RESERVED_NAMESPACES)) {
    for (const field of Object.keys(fields)) {
      names.push(`${namespace}.${field}`)
    }
  }

  return names
}

/**
 * Get variable definition by full name (namespace.field)
 */
export function getVariableDefinition(fullName: string): VariableDefinition | undefined {
  const dotIndex = fullName.indexOf('.')
  if (dotIndex === -1) return undefined

  const namespace = fullName.slice(0, dotIndex)
  const field = fullName.slice(dotIndex + 1)

  if (!isReservedNamespace(namespace)) return undefined

  return getReservedFieldDefinition(namespace, field)
}
