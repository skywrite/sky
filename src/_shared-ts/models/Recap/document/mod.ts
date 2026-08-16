import Document from '#shared/models/Markdown/Document/mod.ts'
import TagSet from '#shared/models/TagSet/mod.ts'
import { When } from '#universal/dates/nbdt/mod.ts'

/**
 * A recap: the daily digest of activity in one connected app (GitHub,
 * Claude Code, ...), filed under the day's `actions/recaps/`.
 *
 * Unlike captures, a recap is not the record — the app is. Recaps are
 * regenerated from the app's own event stream, so they are safe to
 * overwrite and their bodies link back to the substance they digest.
 */
export default class RecapDocument extends Document {
  constructor(yaml: Record<string, unknown> = {}, markdown = '', yamlError?: string) {
    // Normalize tags to string format if they're an array or other format
    const normalizedYaml = { ...yaml }
    if (normalizedYaml['tags']) {
      const tags = TagSet.fromUnknown(normalizedYaml['tags'])
      normalizedYaml['tags'] = String(tags)
    }

    super(normalizedYaml, markdown, yamlError)
  }

  // Typed accessors for YAML fields

  /** Connected app this recap digests, e.g. "github", "claude-code". */
  get app(): string {
    return (this.yaml['app'] as string) ?? ''
  }

  get what(): string {
    return (this.yaml['what'] as string) ?? ''
  }

  /**
   * First → last activity span. A span of events, never a length — a recap
   * witnesses activity; it must not manufacture an hours-worked figure.
   */
  get when(): When | undefined {
    if (this.yaml['when'] === undefined || this.yaml['when'] === null) return undefined
    return When.fromYaml(this.yaml['when'])
  }

  /**
   * Create a new RecapDocument from props
   */
  static create(props: {
    app: string
    what: string
    when?: When | string
    tags?: TagSet | string
    rel?: string | string[]
    body: string
  }): RecapDocument {
    // rel:/tags: are always present — empty slots to fill, matching the
    // other day-doc kinds (Event, Meeting).
    const yaml: Record<string, unknown> = {
      app: props.app,
      what: props.what,
    }
    if (props.when) yaml['when'] = When.from(props.when).toYaml()
    yaml['rel'] = props.rel || null
    yaml['tags'] = props.tags || null

    return new RecapDocument(yaml, props.body)
  }

  /**
   * Load a RecapDocument from a markdown file
   */
  static override fromMarkdown(contentsWithYamlHeader: string): RecapDocument {
    const doc = super.fromMarkdown(contentsWithYamlHeader)
    return new RecapDocument(doc.yaml, doc.markdown, doc.yamlError)
  }
}
