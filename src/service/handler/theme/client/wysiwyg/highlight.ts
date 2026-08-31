/**
 * Syntax highlighting for fences (FEN-1): highlight.js over the block's text, with the languages
 * the notebook writes registered by name and alias. The output keeps every character of the code
 * — only spans go around its tokens — so what the editor reads back from the block is unchanged.
 */

/// <reference types="highlight.js" />

import hljs from 'highlight.js/lib/core.js'
import bash from 'highlight.js/lib/languages/bash.js'
import c from 'highlight.js/lib/languages/c.js'
import cpp from 'highlight.js/lib/languages/cpp.js'
import css from 'highlight.js/lib/languages/css.js'
import diff from 'highlight.js/lib/languages/diff.js'
import dockerfile from 'highlight.js/lib/languages/dockerfile.js'
import go from 'highlight.js/lib/languages/go.js'
import ini from 'highlight.js/lib/languages/ini.js'
import java from 'highlight.js/lib/languages/java.js'
import javascript from 'highlight.js/lib/languages/javascript.js'
import json from 'highlight.js/lib/languages/json.js'
import kotlin from 'highlight.js/lib/languages/kotlin.js'
import makefile from 'highlight.js/lib/languages/makefile.js'
import markdown from 'highlight.js/lib/languages/markdown.js'
import php from 'highlight.js/lib/languages/php.js'
import python from 'highlight.js/lib/languages/python.js'
import ruby from 'highlight.js/lib/languages/ruby.js'
import rust from 'highlight.js/lib/languages/rust.js'
import scss from 'highlight.js/lib/languages/scss.js'
import shell from 'highlight.js/lib/languages/shell.js'
import sql from 'highlight.js/lib/languages/sql.js'
import swift from 'highlight.js/lib/languages/swift.js'
import typescript from 'highlight.js/lib/languages/typescript.js'
import xml from 'highlight.js/lib/languages/xml.js'
import yaml from 'highlight.js/lib/languages/yaml.js'

type LanguageFn = typeof javascript

const LANGUAGES: Record<string, LanguageFn> = {
  bash,
  c,
  cpp,
  css,
  diff,
  dockerfile,
  go,
  ini,
  java,
  javascript,
  json,
  kotlin,
  makefile,
  markdown,
  php,
  python,
  ruby,
  rust,
  scss,
  shell,
  sql,
  swift,
  typescript,
  xml,
  yaml,
}

/** The names highlight.js colors by here: the languages above and their own aliases. */
const ACCEPTED = new Map<string, string>()
for (const [name, language] of Object.entries(LANGUAGES)) {
  hljs.registerLanguage(name, language)
  ACCEPTED.set(name, name)
  for (const alias of language(hljs).aliases ?? []) ACCEPTED.set(alias.toLowerCase(), alias)
}

/** Info strings the notebook writes that highlight.js knows under another name — or not at all. */
const ALIASES: Record<string, string> = {
  htm: 'xml',
  jsonc: 'json',
  json5: 'json',
  svelte: 'xml',
  terminal: 'shell',
  vue: 'xml',
}

/** Info strings that mean "leave the text alone". */
const PLAIN = new Set(['plain', 'plaintext', 'text', 'txt'])

/** Very long fences stay uncolored: the repaint would cost more than the color is worth. */
export const HIGHLIGHT_LIMIT = 20_000

/** The name highlight.js colors a fence's info string by, or null when the text stays as it is. */
export function highlightLanguage(info: string | undefined): string | null {
  const word =
    (info ?? '')
      .trim()
      .split(/[\s{,]/, 1)[0]
      ?.toLowerCase() ?? ''
  if (word.length === 0 || PLAIN.has(word)) return null
  const name = ALIASES[word] ?? word
  return ACCEPTED.get(name) ?? null
}

/** The code as HTML with spans around its tokens, or null when it is not colored. */
export function highlightCode(text: string, info: string | undefined): string | null {
  const language = highlightLanguage(info)
  if (!language || text.length > HIGHLIGHT_LIMIT) return null
  try {
    return hljs.highlight(text, { language, ignoreIllegals: true }).value
  } catch {
    return null
  }
}

/**
 * Colors the code blocks of rendered markdown in place — `<pre><code class="language-…">` as
 * marked writes them — so a document reads with the colors it is edited with.
 */
export function highlightCodeBlocks(root: ParentNode): void {
  for (const code of root.querySelectorAll<HTMLElement>('pre > code[class*="language-"]')) {
    const lang = /(?:^|\s)language-(\S+)/.exec(code.className)?.[1]
    const colored = highlightCode(code.textContent ?? '', lang)
    if (colored !== null) code.innerHTML = colored
  }
}
