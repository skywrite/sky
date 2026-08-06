import MessageDocument from '#shared/models/Message/mod.ts'
import { PlainDateTime, When } from '#universal/dates/nbdt/mod.ts'

export default class EmailDocument extends MessageDocument {
  // created/updated appear only in legacy files — creation no longer stamps them
  static override yamlKeyOrder = [
    'from',
    'to',
    'cc',
    'bcc',
    'when',
    'medium',
    'subject',
    'summary',
    'created',
    'updated',
    'follow',
    'previous',
    'rel',
    'tags',
    'attachments',
  ]

  /**
   * Create a new email:  new EmailDocument({ from, to, cc, bcc, when, subject, summary })
   * Parse an existing one: EmailDocument.fromMarkdown(contents)
   */
  constructor(input: Record<string, unknown>, markdown?: string, yamlError?: string) {
    let yaml: Record<string, unknown>
    let md: string

    if (markdown === undefined) {
      // Creation: destructure fields that need normalization, rest passes through
      const { when: whenRaw, created: _c, updated: _u, cc, bcc, ...extra } = input
      const when = When.from(whenRaw as Parameters<typeof When.from>[0]).toYaml()

      yaml = {
        from: input['from'] ?? null,
        to: input['to'] ?? null,
        ...(cc ? { cc } : {}),
        ...(bcc ? { bcc } : {}),
        when,
        medium: 'Email',
        subject: input['subject'] ?? null,
        summary: input['summary'] ?? null,
        rel: input['rel'] ?? null,
        tags: input['tags'] ?? null,
        ...extra,
      }
      md = ''
    } else {
      yaml = input
      md = markdown
    }

    // Pass to super with explicit markdown to skip MessageDocument's creation logic
    super(yaml, md, yamlError)
  }

  // Additional typed accessors for Email-specific fields
  get cc(): string | undefined {
    return this.yaml['cc'] as string | undefined
  }

  get bcc(): string | undefined {
    return this.yaml['bcc'] as string | undefined
  }

  get subject(): string | undefined {
    return this.yaml['subject'] as string | undefined
  }

  static override fromMarkdown(contentsWithYamlHeader: string): EmailDocument {
    const doc = super.fromMarkdown(contentsWithYamlHeader)
    return new EmailDocument(doc.yaml, doc.markdown, doc.yamlError)
  }
}
