import Document from '#shared/models/Markdown/Document/mod.ts'
import TagSet from '#shared/models/TagSet/mod.ts'
import { PlainDateTime, When } from '#universal/dates/nbdt/mod.ts'

export type MediumMessage =
  | 'Email'
  | 'Slack'
  | 'WhatsApp'
  | 'iMessage'
  | 'SMS'
  | 'Signal'
  | 'Telegram'
  | 'Discord'
  | 'Teams'

export default class MessageDocument extends Document {
  // created/updated appear only in legacy files — creation no longer stamps them
  static override yamlKeyOrder = [
    'from',
    'to',
    'when',
    'medium',
    'summary',
    'created',
    'updated',
    'follow',
    'previous',
    'link',
    'rel',
    'tags',
    'attachments',
  ]
  /**
   * Create a new message:  new MessageDocument({ from, to, when, medium, summary })
   * Parse an existing one: MessageDocument.fromMarkdown(contents)
   *
   * When no markdown is provided (creation), builds YAML with known fields in
   * display order. Day-partitioned docs carry no created/updated stamps — the
   * day dir dates them — so any incoming ones are stripped. Extra fields from
   * input (e.g., attachments from a previous capture) pass through via ...extra.
   */
  constructor(input: Record<string, unknown>, markdown?: string, yamlError?: string) {
    let yaml: Record<string, unknown>

    if (markdown === undefined) {
      // Creation: destructure fields that need normalization, rest passes through
      const { when: whenRaw, created: _c, updated: _u, ...extra } = input
      const when = When.from(whenRaw as Parameters<typeof When.from>[0]).toYaml()

      yaml = {
        from: input['from'] ?? null,
        to: input['to'] ?? null,
        when,
        medium: input['medium'],
        summary: input['summary'] ?? null,
        rel: input['rel'] ?? null,
        tags: input['tags'] ?? null,
        ...extra,
      }
    } else {
      yaml = { ...input }
    }

    // Normalize tags
    if (yaml['tags']) {
      yaml['tags'] = String(TagSet.fromUnknown(yaml['tags']))
    }

    super(yaml, markdown ?? '', yamlError)
  }

  // Typed accessors for YAML fields
  get from(): string | undefined {
    return this.yaml['from'] as string | undefined
  }

  get to(): string | undefined {
    return this.yaml['to'] as string | undefined
  }

  get when(): When {
    return When.fromYaml(this.yaml['when'])
  }

  get medium(): string {
    return (this.yaml['medium'] as string) ?? ''
  }

  get summary(): string | undefined {
    return this.yaml['summary'] as string | undefined
  }

  // Time-ref link to the previous message in a follow chain (e.g. "19/actions/messages/slack_...")
  // Set by slack:follow:check and slack:follow:message when a follow has prior messages
  get previous(): string | undefined {
    return this.yaml['previous'] as string | undefined
  }

  static override fromMarkdown(contentsWithYamlHeader: string): MessageDocument {
    const doc = super.fromMarkdown(contentsWithYamlHeader)
    return new MessageDocument(doc.yaml, doc.markdown, doc.yamlError)
  }
}
