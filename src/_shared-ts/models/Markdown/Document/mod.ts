import * as marked from 'marked'
import ImmutableSet from '#shared/models/ImmutableSet/mod.ts'
import TagSet from '#shared/models/TagSet/mod.ts'
import { parseWithError, stringify } from '#shared/yaml/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { fetchLinksFromTokensList, type Link, linkMapToTokenLinks } from '../Link/mod.ts'
import renderMarkdown from '../util/renderMarkdown.ts'
import splitYamlMarkdown from '../util/splitYamlMarkdown.ts'
import _stripHtmlComments from './_stripHtmlComments.ts'
import { type Attachment, attachmentsToYaml, parseAttachments } from './attachment.ts'

/** Reference-link definition line, e.g. `[label]: https://example.com` */
const REFERENCE_DEFINITION = /^\[[^\]]+\]:\s/m

export default class Document {
  public readonly markdown: string
  public readonly yamlError?: string

  protected _yaml: Record<string, unknown>
  private _markdownTokens: marked.TokensList | null = null
  private _linksMap: Map<string, Link> | null = null

  /**
   * Preferred key order for YAML frontmatter.
   * Override in subclasses to define consistent key ordering.
   */
  static yamlKeyOrder: string[] = []

  constructor(yaml: Record<string, unknown> = {}, markdown = '', yamlError?: string) {
    this.markdown = markdown
    this._yaml = structuredClone(yaml)
    this.yamlError = yamlError
  }

  /**
   * Lexed lazily on first access (mirrors SectionDocument's lazy sections):
   * marked's lexer is quadratic on large docs and dominates store scans,
   * yet most documents (query filtering, boot indexing) never need tokens.
   * See _regressions/large-doc-performance_test.ts.
   */
  public get markdownTokens(): marked.TokensList {
    if (this._markdownTokens === null) {
      this._markdownTokens = marked.lexer(this.markdown, {})
    }
    return this._markdownTokens
  }

  /** See toMarkdown — the raw body is authoritative only under these terms. */
  private canSkipTokenRender(links: boolean): boolean {
    return this._markdownTokens === null && links && !REFERENCE_DEFINITION.test(this.markdown)
  }

  /** Read-only for subclasses; only updateLinks replaces the cache. */
  protected get _links(): Map<string, Link> {
    if (this._linksMap === null) {
      this._linksMap = fetchLinksFromTokensList(this.markdownTokens)
    }
    return this._linksMap
  }

  public get links(): Map<string, Link> {
    return new Map<string, Link>(this._links)
  }

  public get tags(): TagSet {
    return TagSet.fromUnknown(this.yaml['tags'])
  }

  public get rel(): ImmutableSet<string> {
    const relValue = this.yaml['rel']

    if (relValue === undefined || relValue === null) {
      return new ImmutableSet<string>()
    }

    if (Array.isArray(relValue)) {
      return ImmutableSet._fromArray(ImmutableSet<string>, relValue)
    }

    if (typeof relValue === 'string') {
      // Handle semicolon-separated string format (for backwards compatibility)
      const items = relValue
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s !== '')
      return ImmutableSet._fromArray(ImmutableSet<string>, items)
    }

    return new ImmutableSet<string>()
  }

  public get yaml(): Record<string, unknown> {
    return this._yaml
  }

  public get created(): PlainDate | undefined {
    const created = this.yaml['created']
    if (typeof created === 'string') {
      return PlainDate.from(created)
    }
    return undefined
  }

  public get updated(): PlainDate | undefined {
    const updated = this.yaml['updated']
    if (typeof updated === 'string') {
      return PlainDate.from(updated)
    }
    return undefined
  }

  public clone(): this {
    const newDoc = (this.constructor as typeof Document).fromMarkdown(this.toMarkdown())
    return newDoc as this
  }

  public referenceLinks(subsetMarkdown: string): Map<string, Link> {
    const links = new Map<string, Link>()

    // does not include subset, return "empty set"
    if (!this.toMarkdown().includes(subsetMarkdown)) return links

    const referenceLabels = Document.extractReferenceLabels(subsetMarkdown)

    // validate links set has all links in subset
    // if not, this is totally a bug
    referenceLabels.forEach((label) => {
      if (!this.links.has(label)) {
        console.warn(`Markdown document does not have a corresponding link for ${label}.`)
      }
    })

    referenceLabels.forEach((label) => {
      if (!this.links.has(label)) return

      links.set(label, this.links.get(label) as Link)
    })

    return links
  }

  public toMarkdown({ yaml = true, links = true }: { yaml?: boolean; links?: boolean } = {}): string {
    // Get key order from the class (allows subclasses to override)
    const keyOrder = (this.constructor as typeof Document).yamlKeyOrder

    const yamlLines = ['---', stringify(this.yaml, keyOrder.length > 0 ? { keyOrder } : undefined), '---']

    if (Object.keys(this.yaml).length === 0) yamlLines.splice(1, 1)

    const yamlStr = yamlLines.join('\n')

    // Untouched tokens mean the raw body is still authoritative, so skip
    // the lex (marked is quadratic — ~85s for a 1MB doc). Three conditions
    // keep the output byte-identical to the token render:
    //   - tokens never materialized (updateLinks mutates them in place)
    //   - links kept ({ links: false } needs the render to drop them)
    //   - no reference-link definitions (the render relocates them to the
    //     end of the body, so the raw text can differ)
    const markdown = this.canSkipTokenRender(links) ? this.markdown : renderMarkdown(this.markdownTokens, { links })

    if (yaml) {
      return yamlStr + '\n\n' + markdown
    } else {
      return markdown
    }
  }

  public updateLinks(links: Map<string, Link>): this {
    const spaceBetweenLinks = '\n\n\n\n'
    let clonedDoc = this.clone()

    // hack to add spaces before links
    // check if spaces already exist
    if (links.size > 0 && !this.toMarkdown({ links: false }).endsWith(spaceBetweenLinks)) {
      const markdownContents = this.toMarkdown() + spaceBetweenLinks
      clonedDoc = (this.constructor as typeof Document).fromMarkdown(markdownContents) as this
    }

    clonedDoc._linksMap = links
    clonedDoc.markdownTokens.links = linkMapToTokenLinks(links)

    return clonedDoc
  }

  public updateTags(tags: TagSet): this {
    const doc = this.clone()
    doc.yaml['tags'] = String(tags)
    return doc as this
  }

  public setRel(rel: ImmutableSet<string>): this {
    const doc = this.clone()
    const relArray = Array.from(rel)
    doc.yaml['rel'] = relArray.length > 0 ? relArray : undefined
    return doc as this
  }

  public addRel(rel: string | ImmutableSet<string>): this {
    let relToAdd: ImmutableSet<string>

    if (typeof rel === 'string') {
      const items = rel
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s !== '')
      relToAdd = ImmutableSet._fromArray(ImmutableSet<string>, items)
    } else {
      relToAdd = rel
    }

    const currentRel = this.rel
    const newRel = currentRel.union(relToAdd)
    return this.setRel(newRel)
  }

  public get attachments(): Attachment[] {
    return parseAttachments(this.yaml['attachments'])
  }

  public setAttachments(attachments: Attachment[]): this {
    const doc = this.clone()
    doc.yaml['attachments'] = attachments.length > 0 ? attachmentsToYaml(attachments) : undefined
    return doc as this
  }

  public addAttachment(attachment: Attachment): this {
    return this.setAttachments([...this.attachments, attachment])
  }

  public updateYaml(yaml: Record<string, unknown>): this {
    const doc = this.clone()
    doc._yaml = Object.assign(doc._yaml, yaml)
    return doc as this
  }

  public ensureCreatedUpdated(): this {
    const today = PlainDate.today().ymd
    const updates: Record<string, unknown> = { updated: today }

    // Only set created if it doesn't exist
    if (!this.yaml['created']) {
      updates.created = today
    }

    return this.updateYaml(updates)
  }

  public ensureUpdated(): this {
    const today = PlainDate.today().ymd
    return this.updateYaml({ updated: today })
  }

  public filterSections(predicate: (heading: marked.Tokens.Heading) => boolean): this {
    const filteredTokens: marked.Token[] = []
    let skipUntilDepth: number | null = null // skip until we hit heading at this depth or higher

    for (const token of this.markdownTokens) {
      if (token.type === 'heading') {
        // Are we currently skipping? Check if we've hit a heading that ends the skip
        if (skipUntilDepth !== null && token.depth <= skipUntilDepth) {
          skipUntilDepth = null // stop skipping
        }

        // Should we keep this section?
        if (skipUntilDepth === null && predicate(token as marked.Tokens.Heading)) {
          filteredTokens.push(token)
        } else {
          skipUntilDepth = token.depth // start skipping at this depth
        }
      } else {
        // Non-heading token: keep only if not skipping
        if (skipUntilDepth === null) {
          filteredTokens.push(token)
        }
      }
    }

    // Convert filtered tokens back to markdown
    const markdown = renderMarkdown(filteredTokens as marked.TokensList, { links: false })

    // Create YAML string with key ordering
    const keyOrder = (this.constructor as typeof Document).yamlKeyOrder
    const yamlLines = ['---', stringify(this.yaml, keyOrder.length > 0 ? { keyOrder } : undefined), '---']
    if (Object.keys(this.yaml).length === 0) yamlLines.splice(1, 1)
    const yamlStr = yamlLines.join('\n')

    // Re-parse into new Document
    const fullMarkdown = Object.keys(this.yaml).length > 0 ? yamlStr + '\n\n' + markdown : markdown
    const newDoc = (this.constructor as typeof Document).fromMarkdown(fullMarkdown) as this

    // Fix up reference links - only include links that are used in filtered content
    const neededLinks = this.referenceLinks(markdown)
    return newDoc.updateLinks(neededLinks) as this
  }

  public stripHtmlComments(): this {
    const markdown = _stripHtmlComments(this.markdown)

    // Create YAML string with key ordering
    const keyOrder = (this.constructor as typeof Document).yamlKeyOrder
    const yamlLines = ['---', stringify(this.yaml, keyOrder.length > 0 ? { keyOrder } : undefined), '---']
    if (Object.keys(this.yaml).length === 0) yamlLines.splice(1, 1)
    const yamlStr = yamlLines.join('\n')

    // Re-parse into new Document
    const fullMarkdown = Object.keys(this.yaml).length > 0 ? yamlStr + '\n\n' + markdown : markdown
    const newDoc = (this.constructor as typeof Document).fromMarkdown(fullMarkdown) as this

    // Fix up reference links - only include links that are used in stripped content
    const neededLinks = new Map<string, Link>()
    for (const label of Document.extractReferenceLabels(markdown)) {
      const link = this.links.get(label)
      if (link) neededLinks.set(label, link)
    }
    return newDoc.updateLinks(neededLinks) as this
  }

  static fromMarkdown(contentsWithOptionalYamlHeader: string): Document {
    const { yaml, markdown } = splitYamlMarkdown(contentsWithOptionalYamlHeader)
    const { data: yamlData, error: yamlError } = parseWithError(yaml)

    return new this(yamlData as Record<string, unknown>, markdown, yamlError)
  }

  static extractReferenceLabels(text: string): string[] {
    // Match either [label][] or [text][label] globally
    const pattern = /\[([^\]]+)\]\[([^\]]*)\]/g
    const labels: string[] = []
    let match

    while ((match = pattern.exec(text)) !== null) {
      // If it's in the format [label][] (second group empty)
      // use the first group, otherwise use the second group
      const label = match[2] || match[1]
      labels.push(label)
    }

    return labels
  }
}
