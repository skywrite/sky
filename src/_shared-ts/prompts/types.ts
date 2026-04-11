/**
 * Current prompt schema version (semver)
 * Increment when breaking changes are made to variable names or semantics
 *
 * 0.2.0 - Namespaced variables (context.notebookDate, user.input, etc.)
 * 0.1.1 - Added USER_INPUT variable
 * 0.1.0 - Initial implementation
 */
export const PROMPT_SCHEMA_VERSION = '0.2.0'

/**
 * Frontmatter structure for .prompt.md files
 */
export interface PromptFrontmatter {
  /** Schema version for this prompt file (semver) */
  schema: string
  /** ISO date when prompt was created */
  created: string
  /** ISO date when prompt was last updated */
  updated: string
  /** Human-readable description of this prompt */
  description: string
}

/**
 * Parsed prompt file
 */
export interface ParsedPrompt {
  /** Frontmatter metadata */
  frontmatter: PromptFrontmatter
  /** Raw template body (Handlebars syntax) */
  body: string
  /** File slug derived from filename */
  slug: string
}

/**
 * Variable type definitions
 */
export type VariableType = 'string' | 'boolean' | 'number' | 'array'

/**
 * Variable definition for autocomplete and documentation
 */
export interface VariableDefinition {
  type: VariableType
  description: string
}

// =============================================================================
// Prompt Spec 0.2.0 Types
// =============================================================================

/**
 * Global context - notebook-wide constants
 * Populated from system configuration
 */
export interface GlobalContext {
  /** User's display name */
  userName?: string
  /** User's company name */
  userCompany?: string
}

/**
 * Prompt metadata - from file frontmatter
 * Auto-populated when rendering a parsed prompt file
 */
export interface PromptMetadata {
  /** File slug (e.g., "journal-questions") */
  name: string
  /** Description from frontmatter */
  description: string
  /** Creation date from frontmatter (YYYY-MM-DD) */
  created: string
  /** Last updated date from frontmatter (YYYY-MM-DD) */
  updated: string
}

/**
 * Runtime context - computed at render time
 * Auto-populated by the system
 */
export interface RuntimeContext {
  /** Current notebook date (YYYY-MM-DD) */
  notebookDate: string
  /** Current notebook time (HH:MM) */
  notebookTime: string
  /** System/wall-clock date (YYYY-MM-DD) */
  systemDate: string
  /** System/wall-clock time (HH:MM) */
  systemTime: string
  /** Notebook timezone (e.g., "America/New_York") */
  notebookTimezone: string
  /** System timezone (e.g., "America/New_York") */
  systemTimezone: string
}

/**
 * User-provided context
 * Caller provides this at render time
 */
export interface UserContext {
  /** User-supplied input to be processed by the template */
  input?: string
  /** Additional user-provided fields */
  [key: string]: unknown
}

/**
 * Input provided by caller to render a prompt
 * Can override any namespace
 */
export interface RenderInput {
  /** Override global context */
  global?: Partial<GlobalContext>
  /** Override runtime context */
  context?: Partial<RuntimeContext>
  /** User-provided values */
  user?: UserContext
  /** Entity namespaces (e.g., meeting.*, decision.*, me.*) */
  [namespace: string]: Record<string, unknown> | object | undefined
}

/**
 * Warning types for variable resolution
 */
export type RenderWarningType =
  | 'bare_variable' // Variable without namespace (e.g., {{FOO}})
  | 'unknown_namespace' // Namespace not found (e.g., {{foo.bar}} where foo is not provided)
  | 'unknown_field' // Field not found in reserved namespace (e.g., {{context.unknown}})

/**
 * Warning generated during prompt rendering
 */
export interface RenderWarning {
  /** Type of warning */
  type: RenderWarningType
  /** Full variable reference (e.g., "context.notebookDate" or "FOO") */
  variable: string
  /** Namespace if applicable */
  namespace?: string
  /** Field name if applicable */
  field?: string
  /** Human-readable message */
  message: string
}

/**
 * Result of rendering a prompt
 */
export interface RenderResult {
  /** Rendered output string */
  output: string
  /** Warnings generated during rendering */
  warnings: RenderWarning[]
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Parse semver string to comparable parts
 */
export function parseSemver(version: string): [number, number, number] {
  const parts = version.split('.').map(Number)
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0]
}

/**
 * Compare two semver versions
 * Returns: -1 if a < b, 0 if a === b, 1 if a > b
 */
export function compareSemver(a: string, b: string): number {
  const [aMajor, aMinor, aPatch] = parseSemver(a)
  const [bMajor, bMinor, bPatch] = parseSemver(b)

  if (aMajor !== bMajor) return aMajor < bMajor ? -1 : 1
  if (aMinor !== bMinor) return aMinor < bMinor ? -1 : 1
  if (aPatch !== bPatch) return aPatch < bPatch ? -1 : 1
  return 0
}
