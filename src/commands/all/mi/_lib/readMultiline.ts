import * as readline from 'node:readline'
import * as p from '@clack/prompts'
import colors from 'picocolors'

/**
 * Read a multi-line answer from the terminal: ENTER starts a new line instead
 * of submitting, so pasted paragraphs — blank lines included — arrive intact.
 * A lone "." line or Ctrl+D finishes the answer; finishing with no content
 * means skip. Returns the text ('' when skipped), or null on Ctrl+C.
 */
export function readMultiline(question: string, hint?: string): Promise<string | null> {
  p.log.step(question)
  p.log.message(colors.dim(hint ?? 'Multi-line — finish with a "." on its own line (or Ctrl+D). Ctrl+C cancels.'))

  return new Promise((resolve) => {
    const lines: string[] = []
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })

    const finish = () => {
      rl.close()
      resolve(lines.join('\n').trim())
    }

    rl.on('line', (line) => {
      if (line.trim() === '.') {
        finish()
        return
      }
      lines.push(line)
    })

    // Ctrl+D on an empty line ends the input stream
    rl.on('close', () => resolve(lines.join('\n').trim()))

    rl.on('SIGINT', () => {
      // Settle before close(): its handler would otherwise resolve with the text
      resolve(null)
      rl.close()
    })
  })
}
