// modified from: https://github.com/jxson/front-matter

import process from 'node:process'

const optionalByteOrderMark = '\\ufeff?'

const isWindows = process.platform === 'win32'

const pattern =
  '^(' +
  optionalByteOrderMark +
  '(= yaml =|---)' +
  '$([\\s\\S]*?)' +
  '^(?:\\2|\\.\\.\\.)\\s*' +
  '$' +
  (isWindows ? '\\r?' : '') +
  '(?:\\n)?)'

// NOTE: If this pattern uses the 'g' flag the `regex` variable definition will
// need to be moved down into the functions that use it.
const regex = new RegExp(pattern, 'm')

export interface SplitYamlMarkdownResult {
  yaml: string
  markdown: string
}

export default function splitYamlMarkdown(markdownWithYaml: string): SplitYamlMarkdownResult {
  if (markdownWithYaml.trim().split('\n').at(0) === '---') {
    const match = regex.exec(markdownWithYaml)
    if (!match) return { yaml: '', markdown: markdownWithYaml }

    const markdown = markdownWithYaml.replace(match[0], '')
    const yaml = match[match.length - 1].replace(/^\s+|\s+$/g, '')

    return { yaml, markdown }
  } else {
    return { yaml: '', markdown: markdownWithYaml }
  }
}
