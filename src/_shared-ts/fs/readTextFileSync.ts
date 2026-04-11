import { readFileSync } from 'node:fs'

export default function readTextFileSync(path: string): string {
  return readFileSync(path, 'utf-8')
}
