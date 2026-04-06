import process from 'node:process'

export default function exit(code?: number): never {
  return process.exit(code) as never
}
