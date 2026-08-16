/**
 * DocumentLinkProvider for person-related fields in YAML frontmatter.
 *
 * Makes comma-separated person names in `who`, `to`, `from`, `cc`, `bcc`
 * fields Cmd+Clickable by resolving them to file paths via the resolveRefs
 * GraphQL query on the running notebook service.
 */

import * as vscode from 'vscode'
import parseDateFromDayPath from '#shared/nbfs/parseDateFromDayPath.ts'

const GRAPHQL_URL = 'http://localhost:9999/graphql'

/** Regex to match the YAML frontmatter block */
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/

/** Fields that contain person names */
const PERSON_FIELDS = new Set(['who', 'to', 'from', 'cc', 'bcc'])

interface ResolvedRef {
  ref: string
  path: string | null
  type: string
}

export default class PersonFieldDocumentLinkProvider implements vscode.DocumentLinkProvider {
  async provideDocumentLinks(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken,
  ): Promise<vscode.DocumentLink[]> {
    const text = document.getText()
    const fmMatch = text.match(FRONTMATTER_RE)
    if (!fmMatch) return []

    const fmEnd = fmMatch.index! + fmMatch[0].length
    const fmText = text.slice(0, fmEnd)

    const entries = this.extractPersonEntries(fmText)
    if (entries.length === 0) return []

    // Extract date context from file path (for time-based ref resolution)
    let year: number | undefined
    let month: number | undefined
    try {
      const date = parseDateFromDayPath(document.uri.fsPath)
      year = date.year
      month = date.month
    } catch {
      // Not a day file — no date context
    }

    // Resolve refs via GraphQL
    const refs = entries.map((e) => e.value)
    const resolved = await this.resolveRefs(refs, year, month, document.uri.fsPath)
    if (!resolved) return []

    // Build document links for resolved refs that have paths
    const links: vscode.DocumentLink[] = []
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      const ref = resolved[i]
      if (!ref?.path) continue

      const link = new vscode.DocumentLink(entry.range, vscode.Uri.file(ref.path))
      link.tooltip = `${ref.type}: ${ref.path}`
      links.push(link)
    }

    return links
  }

  /**
   * Extract person names from frontmatter fields with their document ranges.
   *
   * Handles both inline and YAML list formats:
   *   who: Alice, Sam, Jane Doe
   *   from: Bob Smith
   *   to: "#project-atlas"
   *   who:
   *     - Alice
   *     - Sam, Jane Doe
   */
  private extractPersonEntries(frontmatter: string): Array<{ value: string; range: vscode.Range }> {
    const entries: Array<{ value: string; range: vscode.Range }> = []
    const lines = frontmatter.split('\n')

    let inPersonList = false

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      // Check for YAML list item under a person field
      if (inPersonList) {
        const listMatch = line.match(/^(\s+-\s+)(.+)$/)
        if (listMatch) {
          this.extractCommaSeparated(entries, i, listMatch[1].length, listMatch[2])
          continue
        }
        // No longer in a list
        inPersonList = false
      }

      // Match `field: value` or `field:` (empty, followed by list)
      const match = line.match(/^(\w+)\s*:\s*(.*)$/)
      if (!match) continue

      const fieldName = match[1]
      if (!PERSON_FIELDS.has(fieldName)) continue

      const valuesStr = match[2].trim()
      if (valuesStr) {
        // Inline: `who: Name1, Name2`
        const valuesStart = line.indexOf(match[2])
        this.extractCommaSeparated(entries, i, valuesStart, match[2])
      } else {
        // Empty value — expect YAML list on next lines
        inPersonList = true
      }
    }

    return entries
  }

  /** Split a string by comma and push each trimmed name with its range */
  private extractCommaSeparated(
    entries: Array<{ value: string; range: vscode.Range }>,
    line: number,
    baseCol: number,
    text: string,
  ): void {
    let offset = 0
    const parts = text.split(',')
    for (const part of parts) {
      const trimmed = part.trim()
      if (trimmed) {
        const trimStart = offset + part.indexOf(trimmed)
        const colStart = baseCol + trimStart
        const range = new vscode.Range(line, colStart, line, colStart + trimmed.length)
        entries.push({ value: trimmed, range })
      }
      offset += part.length + 1
    }
  }

  private async resolveRefs(
    refs: string[],
    year?: number,
    month?: number,
    sourceFilePath?: string,
  ): Promise<ResolvedRef[] | null> {
    try {
      const query = `query ResolveRefs($refs: [String!]!, $year: Int, $month: Int, $sourceFilePath: String) {
        resolveRefs(refs: $refs, year: $year, month: $month, sourceFilePath: $sourceFilePath) {
          ref
          path
          type
        }
      }`

      const response = await fetch(GRAPHQL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          variables: { refs, year: year ?? null, month: month ?? null, sourceFilePath: sourceFilePath ?? null },
        }),
      })

      if (!response.ok) return null

      const result = (await response.json()) as { data?: { resolveRefs: ResolvedRef[] } }
      return result.data?.resolveRefs ?? null
    } catch {
      // Server not running or network error
      return null
    }
  }
}
