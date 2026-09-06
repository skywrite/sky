import splitYamlMarkdown from '#shared/models/Markdown/util/splitYamlMarkdown.ts'
import { parse as parseYaml } from '#shared/yaml/mod.ts'
import type { ParsedPrompt, PromptFrontmatter } from './types.ts'
import { compareSemver, PROMPT_SCHEMA_VERSION } from './types.ts'

/**
 * Extract slug from a prompt filename
 * e.g., "journal-questions.prompt.md" -> "journal-questions"
 */
export function extractSlug(filename: string): string {
  return filename.replace(/\.prompt\.md$/, '')
}

/**
 * Parse a .prompt.md file content into frontmatter and body
 */
export function parsePromptFile(content: string, filename: string): ParsedPrompt {
  const slug = extractSlug(filename)

  // Split frontmatter from body using project utility
  const { yaml: yamlContent, markdown: body } = splitYamlMarkdown(content)

  // Parse YAML using project's yaml module (npm:yaml keeps dates as strings)
  const parsedYaml: unknown = yamlContent ? parseYaml(yamlContent) : {}
  const rawFrontmatter =
    parsedYaml && typeof parsedYaml === 'object' && !Array.isArray(parsedYaml)
      ? (parsedYaml as Record<string, unknown>)
      : {}

  // Check version compatibility (file version must not exceed system version)
  const schema = typeof rawFrontmatter.schema === 'string' ? rawFrontmatter.schema : PROMPT_SCHEMA_VERSION
  if (compareSemver(schema, PROMPT_SCHEMA_VERSION) > 0) {
    console.warn(
      `⚠️  Prompt file "${filename}" uses schema version ${schema}, ` +
        `but this system only supports up to version ${PROMPT_SCHEMA_VERSION}. ` +
        `Proceeding anyway — some features may not work as expected.`,
    )
  }

  const frontmatter: PromptFrontmatter = {
    schema,
    created: typeof rawFrontmatter.created === 'string' ? rawFrontmatter.created : '',
    updated: typeof rawFrontmatter.updated === 'string' ? rawFrontmatter.updated : '',
    description: typeof rawFrontmatter.description === 'string' ? rawFrontmatter.description : '',
  }

  return {
    frontmatter,
    body: body.trim(),
    slug,
  }
}
