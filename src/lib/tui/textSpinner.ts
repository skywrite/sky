import colors from 'picocolors'

export interface TextSpinner {
  start(msg: string): void
  stop(finalMsg?: string): void
}

/**
 * Minimal stdout-only spinner with the clack visual language.
 *
 * Unlike @clack/prompts' spinner, it NEVER touches stdin: clack's spinner
 * calls block(), which wraps stdin in a readline interface and flips it into
 * flowing keypress mode. Under bun, an Ink prompt rendered after that never
 * gets its paused-mode 'readable' events back — input goes dead. Use this
 * spinner in any flow that renders Ink prompts between waits.
 */
export function textSpinner(): TextSpinner {
  const frames = ['◒', '◐', '◓', '◑']
  const out = globalThis.process.stdout
  let timer: ReturnType<typeof setInterval> | undefined
  let message = ''

  return {
    start(msg: string) {
      message = msg
      if (!out.isTTY) return
      let i = 0
      out.write('\x1b[?25l')
      timer = setInterval(() => {
        out.write(`\r\x1b[2K${colors.magenta(frames[i++ % frames.length])}  ${message}`)
      }, 80)
    },
    stop(finalMsg?: string) {
      if (timer) clearInterval(timer)
      timer = undefined
      if (out.isTTY) out.write('\r\x1b[2K\x1b[?25h')
      out.write(`${colors.gray('◇')}  ${finalMsg ?? message}\n`)
    },
  }
}
