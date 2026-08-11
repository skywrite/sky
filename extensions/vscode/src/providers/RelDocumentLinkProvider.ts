/**
 * DocumentLinkProvider for ref-like field values in YAML frontmatter.
 *
 * Makes values in `rel:`, `previous:`, `ib:`, and similar fields Cmd+Clickable
 * by resolving them to file paths via the resolveRefs GraphQL query.
 */

import * as vscode from 'vscode'
import parseDateFromDayPath from '#shared/nbfs/parseDateFromDayPath.ts'

const GRAPHQL_URL = 'http://localhost:9999/graphql'

/** Regex to match the YAML frontmatter block */
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/

/** Frontmatter fields whose values are resolved as refs */
const REF_FIELDS = new Set(['rel', 'previous', 'ib'])

interface ResolvedRef {
  ref: string
  path: string | null
  type: string
}

export default class RelDocumentLinkProvider implements vscode.DocumentLinkProvider {
  async provideDocumentLinks(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken,
  ): Promise<vscode.DocumentLink[]> {
    const text = document.getText()
    const fmMatch = text.match(FRONTMATTER_RE)
    if (!fmMatch) return []

    const fmEnd = fmMatch.index! + fmMatch[0].length
    const fmText = text.slice(0, fmEnd)

    // Find rel: entries with their line positions
    const entries = this.extractRelEntries(document, fmText)
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
   * Extract values from ref-like frontmatter fields (rel, previous, etc.)
   * with their document ranges.
   *
   * Handles both inline scalar and YAML array formats:
   *   previous: ./slack_channel_summary.md
   *   rel:
   *     - Alice Smith
   *     - projects/Alpha
   */
  private extractRelEntries(
    document: vscode.TextDocument,
    frontmatter: string,
  ): Array<{ value: string; range: vscode.Range }> {
    const entries: Array<{ value: string; range: vscode.Range }> = []
    const lines = frontmatter.split('\n')

    let inBlock = false
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      // Start of a ref field block
      const fieldMatch = line.match(/^(\w+)\s*:/)
      if (fieldMatch && REF_FIELDS.has(fieldMatch[1])) {
        inBlock = true

        // Check for inline scalar: `field: Something`
        const inlineMatch = line.match(/^\w+\s*:\s+(.+)$/)
        if (inlineMatch) {
          const value = inlineMatch[1].trim()
          if (value && !value.startsWith('-')) {
            const valueStart = line.indexOf(value)
            const range = new vscode.Range(i, valueStart, i, valueStart + value.length)
            entries.push({ value, range })
          }
          inBlock = false
        }
        continue
      }

      // Inside array block
      if (inBlock) {
        const arrayMatch = line.match(/^(\s+)-\s+(.+)$/)
        if (arrayMatch) {
          const value = arrayMatch[2].trim()
          if (value) {
            const valueStart = line.indexOf(value)
            const range = new vscode.Range(i, valueStart, i, valueStart + value.length)
            entries.push({ value, range })
          }
        } else if (/^\S/.test(line)) {
          // New top-level key — we've left the block
          inBlock = false
        }
      }
    }

    return entries
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
