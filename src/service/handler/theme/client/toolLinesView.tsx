import { Fragment } from 'react'
import { toolDisplayName } from '#universal/ai/toolDisplay.ts'
import { fileHref } from './explorer.tsx'
import { RenderedHtml } from './renderedHtml.tsx'
import { type CallEntry, GRAPHQL, graphqlTokens, humanize, parseToolLine, type ToolEntry } from './toolLines.ts'
import { renderStatic } from './wysiwyg/render.ts'

/** A notebook-relative markdown path — a file with a page of its own. */
const NOTEBOOK_FILE = /^(?!\/)[^\s"]+\.md$/

/**
 * Everything a tool said, opened: one card per entry, like messages in a
 * thread. A call the tool made reads as its name and what it asked in
 * full — a query as a colored block, a notebook file as a link to its
 * page; anything else as the words the tool printed, paragraphs kept.
 */
export function RunLines({ lines }: { lines: string[] }) {
  return (
    <div className="sky-tool-lines">
      {lines.map((line, i) => (
        <Fragment key={i}>
          <LineEntry entry={parseToolLine(line)} />
        </Fragment>
      ))}
    </div>
  )
}

function LineEntry({ entry }: { entry: ToolEntry }) {
  if (entry.kind === 'said') {
    // A line that is a notebook file — a source it lists, a file it wrote — opens that file.
    if (NOTEBOOK_FILE.test(entry.text))
      return <NotebookLink path={entry.text} className="sky-tool-entry sky-tool-said sky-tool-file" />
    return <TextBlock className="sky-tool-entry sky-tool-said" text={entry.text} />
  }
  return (
    <div className="sky-tool-entry sky-tool-call">
      <div className="sky-tool-call-name">{toolDisplayName(entry.tool)}</div>
      {entry.detail !== null && <CallDetail entry={entry} />}
    </div>
  )
}

/** Several paragraphs read as markdown; one line stays as it is. */
function TextBlock({ text, className }: { text: string; className: string }) {
  const html = text.includes('\n') ? render(text) : null
  if (html) return <RenderedHtml className={`${className} sky-rendered`} html={html} />
  return <div className={className}>{text}</div>
}

function render(markdown: string): string | null {
  try {
    return renderStatic(markdown)
  } catch {
    return null
  }
}

/** A query, colored by token; a record cut short ends in an ellipsis. */
function GraphQLBlock({ code, cut = false }: { code: string; cut?: boolean }) {
  return (
    <pre className="sky-tool-code">
      {graphqlTokens(code).map((token, i) =>
        token.type === 'text' ? (
          <Fragment key={i}>{token.text}</Fragment>
        ) : (
          <span key={i} className={`sky-gql-${token.type}`}>
            {token.text}
          </span>
        ),
      )}
      {cut && <span className="sky-tool-cut">…</span>}
    </pre>
  )
}

function CallDetail({ entry }: { entry: CallEntry }) {
  const detail = entry.detail ?? ''
  if (entry.graphql) return <GraphQLBlock code={detail} cut={entry.cut} />
  if (!entry.cut && NOTEBOOK_FILE.test(detail)) return <NotebookLink path={detail} className="sky-tool-call-text" />
  return (
    <div className="sky-tool-call-text">
      {detail}
      {entry.cut && <span className="sky-tool-cut">…</span>}
    </div>
  )
}

function NotebookLink({ path, className }: { path: string; className?: string }) {
  return (
    <a className={className} href={fileHref(path)}>
      {path}
    </a>
  )
}

/**
 * A tool's input or output as a person reads it: each field by name, a
 * string as its text with its paragraphs kept, a GraphQL query as a
 * colored block, a list one item per line, anything nested as JSON.
 */
export function FieldsView({ value }: { value: unknown }) {
  if (typeof value === 'string') return <FieldValue name="" value={value} />
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return <FieldValue name="" value={value} />
  const fields = Object.entries(value as Record<string, unknown>)
  if (fields.length === 0) return <div className="sky-tool-text sky-tool-empty">nothing</div>
  return (
    <dl className="sky-tool-fields">
      {fields.map(([name, field]) => (
        <Fragment key={name}>
          <dt>{humanize(name)}</dt>
          <dd>
            <FieldValue name={name} value={field} />
          </dd>
        </Fragment>
      ))}
    </dl>
  )
}

function FieldValue({ name, value }: { name: string; value: unknown }) {
  if (typeof value === 'string') {
    if (name === 'graphql' || GRAPHQL.test(value)) return <GraphQLBlock code={value} />
    return <TextBlock className="sky-tool-text" text={value} />
  }
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return (
      <ul className="sky-tool-list">
        {(value as string[]).map((item, i) => (
          <li key={i}>{NOTEBOOK_FILE.test(item) ? <NotebookLink path={item} /> : item}</li>
        ))}
      </ul>
    )
  }
  if (value === null || typeof value !== 'object') return <div className="sky-tool-text">{String(value)}</div>
  return <pre className="sky-tool-json">{JSON.stringify(value, null, 2)}</pre>
}
