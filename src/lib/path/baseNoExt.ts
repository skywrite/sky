import * as path from 'node:path'

export default function baseNoExt(file: string): string {
  return path.basename(file, path.extname(file))
}
