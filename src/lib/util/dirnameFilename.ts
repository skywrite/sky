export type FileLocation = {
  __dirname: string
  __filename: string
}

export default function dirnameFilename(url: string): FileLocation {
  const __filename = new URL('', url).pathname
  const __dirname = new URL('.', url).pathname
  return { __dirname, __filename }
}
