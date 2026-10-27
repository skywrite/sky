import { renderStatic } from '../editor/wysiwyg/render.ts'
import { RenderedHtml } from '../lib/renderedHtml.tsx'

export function Prose({ text }: { text: string }) {
  return <RenderedHtml className="sky-workstream-prose" html={renderStatic(text)} />
}
