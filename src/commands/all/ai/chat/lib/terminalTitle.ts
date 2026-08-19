import process from 'node:process'

// OSC 0 names both the window and the tab, and passes through even while Ink
// holds the alternate screen buffer. Terminals render the title raw, so the
// text must carry no control bytes and stay short enough for a tab.
const MAX_TITLE_CHARS = 80

/** The escape sequence that sets the terminal window/tab title. */
export function titleSequence(title: string): string {
  const clean = title
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, MAX_TITLE_CHARS)
  return `\u001b]0;${clean}\u0007`
}

/** Set the terminal tab title (no-op when stdout is not a TTY). */
export function setTerminalTitle(title: string): void {
  if (!process.stdout.isTTY) return
  process.stdout.write(titleSequence(title))
}

/** Blank the title on exit so the shell's own naming takes back over. */
export function clearTerminalTitle(): void {
  if (!process.stdout.isTTY) return
  process.stdout.write(titleSequence(''))
}
