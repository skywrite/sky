import expand from '#shared/strings/expand.ts'
import { miFrontmatter } from './frontmatter.ts'
import MostImportant from './mod.ts'

export default function template(mimp: MostImportant): string {
  const markdownLines = ['', '', `# **${mimp.YMD} - ${mimp.dayWordShort}**`, '']

  function renderQuestions(questions: string[], depth: number): void {
    const headerIndent = expand('#', depth)
    questions.forEach((q) => {
      markdownLines.push(`${headerIndent} ${q}`)
      markdownLines.push(...expandNewlines(2))
    })
  }

  renderQuestions(mimp['_questions'], 2)

  const markdown = markdownLines.join('\n').trimEnd()

  return miFrontmatter(mimp.summary) + markdown + '\n'
}

function expandNewlines(n: number): string[] {
  return Array(n).fill('\n')
}
