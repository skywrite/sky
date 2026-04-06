import { stringify } from './stringify/mod.ts'

export default function stringifyForMarkdown(obj: unknown): string {
  const yaml = stringify(obj)
  return ['---', yaml, '---', '\n'].join('\n')
}
