import Handlebars from 'handlebars'

// Disable HTML escaping - we're generating AI prompts, not HTML
// Preserve original behavior: return empty string for null/undefined
Handlebars.Utils.escapeExpression = (str: string) => (str == null ? '' : str)

import { FILE_ABOUT_ME } from '#shared/config.ts'
import { readTextFileSync } from '#shared/fs/mod.ts'
import { AboutMeDocument } from '#shared/models/AboutMe/mod.ts'
import { parsePromptFile } from './parse.ts'
import type {
  GlobalContext,
  ParsedPrompt,
  PromptMetadata,
  RenderInput,
  RenderResult,
  RenderWarning,
  RuntimeContext,
} from './types.ts'
import { getReservedFieldDefinition, isReservedNamespace } from './variables.ts'

// =============================================================================
// Context Building
// =============================================================================

/**
 * Build default me context from journal/about-me.md
 */
function buildMeDefaults(): AboutMeDocument | undefined {
  try {
    return AboutMeDocument.fromMarkdown(readTextFileSync(FILE_ABOUT_ME))
  } catch {
    return undefined
  }
}

/**
 * Build default global context from system configuration
 */
function buildGlobalDefaults(): GlobalContext {
  // In the future, these could come from a config file
  return {
    userName: undefined,
    userCompany: undefined,
  }
}

/**
 * Build default runtime context
 * In a real scenario, these would come from the task context
 */
function buildContextDefaults(): RuntimeContext {
  const now = new Date()
  const date = now.toISOString().slice(0, 10)
  const time = now.toTimeString().slice(0, 5)
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone

  return {
    notebookDate: date,
    notebookTime: time,
    systemDate: date,
    systemTime: time,
    notebookTimezone: timezone,
    systemTimezone: timezone,
  }
}

/**
 * Build prompt metadata from parsed prompt
 */
function buildPromptContext(parsed: ParsedPrompt): PromptMetadata {
  return {
    name: parsed.slug,
    description: parsed.frontmatter.description,
    created: parsed.frontmatter.created,
    updated: parsed.frontmatter.updated,
  }
}

/**
 * Deep merge input over defaults, preserving namespace structure
 */
function mergeContexts(
  defaults: Record<string, Record<string, unknown>>,
  input: RenderInput,
): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {}

  // Copy defaults
  for (const [ns, fields] of Object.entries(defaults)) {
    result[ns] = { ...fields }
  }

  // Merge input namespaces
  for (const [ns, fields] of Object.entries(input)) {
    if (fields === undefined) continue
    if (result[ns]) {
      result[ns] = { ...result[ns], ...fields }
    } else {
      result[ns] = { ...fields }
    }
  }

  return result
}

// No flattening needed - Handlebars handles nested paths like {{context.notebookDate}} natively

// =============================================================================
// Warning Detection
// =============================================================================

/**
 * Find all variable references in a template
 */
function findVariableReferences(template: string): string[] {
  const references: string[] = []

  // Match {{varName}} but not {{#if}}, {{/if}}, {{else}}, etc.
  // Also handle {{#if varName}}, {{#unless varName}}, {{#each varName}}
  const patterns = [
    // Simple variables: {{foo}} or {{foo.bar}}
    /\{\{([a-zA-Z_][a-zA-Z0-9_.]*)\}\}/g,
    // Block helpers: {{#if foo}}, {{#unless foo}}, {{#each foo}}
    /\{\{#(?:if|unless|each)\s+([a-zA-Z_][a-zA-Z0-9_.]*)\}\}/g,
  ]

  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(template)) !== null) {
      references.push(match[1])
    }
  }

  return [...new Set(references)] // Deduplicate
}

/**
 * Check variable references and generate warnings
 */
function checkVariables(template: string, context: Record<string, Record<string, unknown>>): RenderWarning[] {
  const warnings: RenderWarning[] = []
  const references = findVariableReferences(template)

  for (const ref of references) {
    const dotIndex = ref.indexOf('.')

    if (dotIndex === -1) {
      // Bare variable (no namespace)
      warnings.push({
        type: 'bare_variable',
        variable: ref,
        message: `Bare variable "${ref}" - use namespace format (e.g., user.input, context.notebookDate)`,
      })
      continue
    }

    const namespace = ref.slice(0, dotIndex)
    const field = ref.slice(dotIndex + 1)

    // Check if namespace exists in context
    if (!(namespace in context)) {
      warnings.push({
        type: 'unknown_namespace',
        variable: ref,
        namespace,
        field,
        message: `Unknown namespace "${namespace}" in variable "${ref}"`,
      })
      continue
    }

    // For reserved namespaces, warn on unknown fields
    if (isReservedNamespace(namespace)) {
      const definition = getReservedFieldDefinition(namespace, field)
      if (!definition && !(field in context[namespace])) {
        warnings.push({
          type: 'unknown_field',
          variable: ref,
          namespace,
          field,
          message: `Unknown field "${field}" in reserved namespace "${namespace}"`,
        })
      }
    }
    // For entity namespaces (non-reserved), we don't warn on unknown fields
    // since they're caller-provided and open-ended
  }

  return warnings
}

// =============================================================================
// Rendering Functions
// =============================================================================

/**
 * Render a parsed prompt with the given input
 */
export function renderParsedPrompt(parsed: ParsedPrompt, input: RenderInput = {}): RenderResult {
  // Build context hierarchy
  const defaults: Record<string, Record<string, unknown>> = {
    global: { ...buildGlobalDefaults() },
    prompt: { ...buildPromptContext(parsed) },
    context: { ...buildContextDefaults() },
    user: {},
  }

  // Merge caller input
  const namespacedContext = mergeContexts(defaults, input)

  // Auto-populate me namespace from AboutMe profile (callers can override)
  if (!namespacedContext.me) {
    const me = buildMeDefaults()
    if (me) {
      namespacedContext.me = {
        firstName: me.firstName,
        lastName: me.lastName,
        fullName: me.fullName,
        location: me.location,
        family: me.family,
        company: me.company,
        title: me.title,
        companyDescription: me.companyDescription,
        communicationStyle: me.communicationStyle,
        decisionMaking: me.decisionMaking,
        technicalContext: me.technicalContext,
        bio: me.bio,
      }
    }
  }

  // Check for warnings
  const warnings = checkVariables(parsed.body, namespacedContext)

  // Compile and render - Handlebars handles nested paths like {{context.notebookDate}} natively
  const template = Handlebars.compile(parsed.body)
  const output = template(namespacedContext)

  return { output, warnings }
}

/**
 * Parse and render a .prompt.md file in one step
 */
export function renderPromptFile(content: string, filename: string, input: RenderInput = {}): RenderResult {
  const parsed = parsePromptFile(content, filename)
  return renderParsedPrompt(parsed, input)
}

/**
 * Compile a template string without parsing frontmatter
 * Useful for testing or one-off templates
 */
export function renderTemplate(template: string, input: RenderInput = {}): RenderResult {
  // Build context hierarchy (no prompt metadata for raw templates)
  const defaults: Record<string, Record<string, unknown>> = {
    global: { ...buildGlobalDefaults() },
    prompt: {},
    context: { ...buildContextDefaults() },
    user: {},
  }

  // Merge caller input
  const namespacedContext = mergeContexts(defaults, input)

  // Auto-populate me namespace from AboutMe profile (callers can override)
  if (!namespacedContext.me) {
    const me = buildMeDefaults()
    if (me) {
      namespacedContext.me = {
        firstName: me.firstName,
        lastName: me.lastName,
        fullName: me.fullName,
        location: me.location,
        family: me.family,
        company: me.company,
        title: me.title,
        companyDescription: me.companyDescription,
        communicationStyle: me.communicationStyle,
        decisionMaking: me.decisionMaking,
        technicalContext: me.technicalContext,
        bio: me.bio,
      }
    }
  }

  // Check for warnings
  const warnings = checkVariables(template, namespacedContext)

  // Compile and render - Handlebars handles nested paths like {{context.notebookDate}} natively
  const compiled = Handlebars.compile(template)
  const output = compiled(namespacedContext)

  return { output, warnings }
}
