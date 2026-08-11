import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as vscode from 'vscode'
import { DIR_TIME } from '#config'
import dayDir from '#shared/nbfs/dayDir.ts'
import parseDateFromDayPath from '#shared/nbfs/parseDateFromDayPath.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { REGEX_YMD_SUBSTR, REGEX_MMDD_SUBSTR, REGEX_DD_SUBSTR } from '#universal/dates/regex/mod.ts'
import { isCursorInYamlFrontmatter } from '../util.ts'

const REGEXES = [REGEX_DD_SUBSTR, REGEX_MMDD_SUBSTR, REGEX_YMD_SUBSTR]

export default class FileCompletionProvider implements vscode.CompletionItemProvider {
  async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
    const inFrontMatter = isCursorInYamlFrontmatter(document, position)
    if (!inFrontMatter) return

    const linePrefix = document.lineAt(position).text.substr(0, position.character)

    let matches = REGEXES.map((r) => linePrefix.match(r))
    if (!matches.some((m) => m)) return

    // remove empty matches
    matches = matches.filter((m) => m)

    const vals: { year?: string; month?: string; day?: string } = {}
    matches.forEach((m) => {
      if (!m?.groups) return // should never happen
      Object.assign(vals, m.groups)
    })

    // Use the file's date as context for missing year/month, not current date
    let fileDate: PlainDate | undefined
    try {
      fileDate = parseDateFromDayPath(document.uri.fsPath)
    } catch {
      // Not a time file, fall back to current date
    }

    const baseDate = fileDate ?? PlainDate.today()
    const day = PlainDate.from({
      year: vals.year ?? baseDate.year,
      month: vals.month ?? baseDate.month,
      day: vals.day ?? baseDate.day,
    })
    // vscode.window.setStatusBarMessage(`DAY: ${day.toString()}`, 10000)

    const searchStr = '/'
    const searchPos = linePrefix.indexOf(searchStr)
    const subPath = linePrefix.replace(linePrefix.slice(0, searchPos + 1), '')
    // console.log(`SUB PATH: ${subPath}`)

    const dateDir = path.join(DIR_TIME, dayDir(day))

    // vscode.window.setStatusBarMessage(`FILE: ${dateDir}`, 10000)

    const potentialDir = path.join(dateDir, subPath)
    // console.log(`potential dir: ${potentialDir}`)
    try {
      const stat = await fs.lstat(potentialDir)
      if (!stat.isDirectory) return
    } catch (e) {
      console.log(`error ${e}`)
      return
    }

    const dirEntries = await fs.readdir(potentialDir, { withFileTypes: true })

    return dirEntries.map((entry) => {
      const name = path.parse(entry.name).name // chop off file extension (noop for dirs)
      const item = new vscode.CompletionItem(name)
      item.range = new vscode.Range(position, position)

      if (entry.isDirectory()) {
        item.insertText = `${name}/`
        item.command = {
          command: 'editor.action.triggerSuggest',
          title: 'Trigger Suggest',
        }
        item.kind = vscode.CompletionItemKind.Folder
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        item.insertText = name
        item.kind = vscode.CompletionItemKind.File
      }

      return item
    })
  }
}
