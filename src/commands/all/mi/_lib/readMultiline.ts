import * as readline from 'node:readline'
import * as p from '@clack/prompts'
import colors from 'picocolors'

/**
 * Read a multi-line answer from the terminal: ENTER starts a new line instead
 * of submitting, so pasted paragraphs — blank lines included — arrive intact.
 * Two empty lines (three ENTERs after text) or Ctrl+D finish the answer; no content
 * means skip. Returns the text ('' when skipped), or null on Ctrl+C.
 */
export function readMultiline(question: string, hint?: string): Promise<string | null> {
  p.log.step(question)
  p.log.message(colors.dim(hint ?? 'Multi-line — press Enter 3 times to finish (or Ctrl+D). Ctrl+C cancels.'))

  return new Promise((resolve) => {
    const lines: string[] = []
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    let emptyLines = 0
    let pasting = false
    let finished = false
    const bracketedPaste = process.stdin.isTTY && process.stdout.isTTY
    const onKeypress = (_text: string | undefined, key: readline.Key) => {
      if (key.name === 'paste-start') pasting = true
      if (key.name === 'paste-end') pasting = false
    }
    process.stdin.on('keypress', onKeypress)
    if (bracketedPaste) process.stdout.write('\x1b[?2004h')

    const finish = (answer: string | null = lines.join('\n').trim()) => {
      if (finished) return
      finished = true
      process.stdin.off('keypress', onKeypress)
      if (bracketedPaste) process.stdout.write('\x1b[?2004l')
      rl.close()
      resolve(answer)
    }

    rl.on('line', (line) => {
      if (finished) return
      // Pasted paragraph breaks are content, not presses of the submit shortcut.
      emptyLines = !pasting && line.trim() === '' ? emptyLines + 1 : 0
      if (emptyLines >= 2) {
        finish()
        return
      }
      lines.push(line)
    })

    // Ctrl+D on an empty line ends the input stream
    rl.on('close', () => finish())

    rl.on('SIGINT', () => finish(null))
  })
}
