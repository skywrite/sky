import * as path from 'node:path'

export default function pathNoExt(file: string): string {
  return file.replace(new RegExp('\\' + path.extname(file) + '$'), '')
}
