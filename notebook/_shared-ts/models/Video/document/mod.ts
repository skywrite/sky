import Document from '#shared/models/Markdown/Document/mod.ts'
import TagSet from '#shared/models/TagSet/mod.ts'
import { PlainDate, PlainDateTime } from '#universal/dates/nbdt/mod.ts'

const DEFAULT_TEMPLATE = `# Video

## Summary

(insert summary here)

## Transcript`

export default class VideoDocument extends Document {
  /**
   * Create a new video:  new VideoDocument({ from, when, medium, summary, body?, rel? })
   * Parse an existing one: VideoDocument.fromMarkdown(contents)
   */
  constructor(input: Record<string, unknown>, markdown?: string, yamlError?: string) {
    let yaml: Record<string, unknown>
    let md: string

    if (markdown === undefined) {
      const { when: whenRaw, created: _c, updated: _u, body, ...extra } = input
      const when = whenRaw instanceof PlainDateTime ? whenRaw.time : (whenRaw ?? new PlainDateTime().time)
      const medium = input['medium'] ?? 'Video'
      const today = PlainDate.today().ymd

      yaml = {
        ...(input['from'] ? { from: input['from'] } : {}),
        ...(input['to'] ? { to: input['to'] } : {}),
        when,
        medium,
        summary: input['summary'] ?? null,
        video: input['video'] ?? { url: null },
        created: today,
        updated: today,
        rel: input['rel'] ?? null,
        tags: input['tags'] ?? null,
        ...extra,
      }

      md = typeof body === 'string' ? body : DEFAULT_TEMPLATE
    } else {
      yaml = { ...input }
      md = markdown
    }

    if (yaml['tags']) {
      yaml['tags'] = String(TagSet.fromUnknown(yaml['tags']))
    }

    super(yaml, md, yamlError)
  }

  get from(): string | undefined {
    return this.yaml['from'] as string | undefined
  }

  get to(): string | undefined {
    return this.yaml['to'] as string | undefined
  }

  get when(): PlainDateTime {
    const when = this.yaml['when']
    if (typeof when === 'string') {
      return PlainDateTime.fromString(when)
    }
    if (when instanceof PlainDateTime) {
      return when
    }
    return new PlainDateTime()
  }

  get medium(): string {
    return (this.yaml['medium'] as string) ?? 'Video'
  }

  get summary(): string | undefined {
    return this.yaml['summary'] as string | undefined
  }

  get videoUrl(): string | undefined {
    const video = this.yaml['video']
    if (video && typeof video === 'object' && !Array.isArray(video)) {
      const url = (video as Record<string, unknown>)['url']
      return typeof url === 'string' ? url : undefined
    }
    return undefined
  }

  static override fromMarkdown(contentsWithYamlHeader: string): VideoDocument {
    const doc = super.fromMarkdown(contentsWithYamlHeader)
    return new VideoDocument(doc.yaml, doc.markdown, doc.yamlError)
  }
}
