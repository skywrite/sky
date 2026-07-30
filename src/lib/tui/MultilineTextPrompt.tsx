/**
 * Lean multiline text prompt with paste support — the input core of
 * ai:chat's ChatInputPrompt (paste blocks, placeholder labels, chunk
 * cooldown) without the chat chrome. For clack-style flows that need one
 * free-text answer where a pasted block must arrive intact.
 *
 * ORDERING CONSTRAINT: never render this after a @clack prompt or spinner on
 * the same stdin. clack wraps stdin in a readline interface (flowing keypress
 * mode); under bun the stream never recovers paused-mode 'readable' delivery,
 * so the Ink prompt renders but receives no input. Sequence flows so that
 * only writes (or lib/tui/textSpinner) happen between clack's last prompt and
 * this one — see streaks:new for the pattern.
 */

import React, { useMemo, useRef, useState } from 'react'
import { Box, render, Text, useApp, useInput } from 'ink'

const CURSOR_BLOCK = '█'
// Bracketed paste markers: \x1b[200~ (start) and \x1b[201~ (end).
// Ink's key parser strips the leading \x1b, so we also strip bare [200~ / [201~.
const PASTE_MARKERS = ['\x1b[200~', '\x1b[201~', '[200~', '[201~']

// Marker format: \x00PASTE_N\x00 where N is the paste block index
// deno-lint-ignore no-control-regex
const PASTE_MARKER_RE = /\x00PASTE_(\d+)\x00/g
// deno-lint-ignore no-control-regex
const PASTE_MARKER_SINGLE_RE = /^\x00PASTE_(\d+)\x00$/

function finalizeInput(raw: string): string {
  return raw.replace(/\n+$/g, '').trim()
}

function isPastedInput(input: string): boolean {
  return input.length > 1 && (input.includes('\n') || input.includes('\r'))
}

function cleanPastedText(input: string): string {
  let text = input
  for (const marker of PASTE_MARKERS) {
    text = text.replaceAll(marker, '')
  }
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n+$/, '')
}

function formatPasteLabel(text: string, index: number): string {
  const lines = text.split('\n')
  return `[Paste ${index + 1}: ${lines.length} line${lines.length === 1 ? '' : 's'}, ${text.length} chars]`
}

export interface MultilinePromptOptions {
  message: string
  placeholder?: string
  hint?: string
  initialValue?: string
}

interface MultilineTextPromptProps extends MultilinePromptOptions {
  onDone: (text: string | null) => void
}

function MultilineTextPrompt({ message, placeholder, hint, initialValue, onDone }: MultilineTextPromptProps) {
  const { exit } = useApp()
  const [buffer, setBuffer] = useState(initialValue ?? '')
  const [pasteBlocks, setPasteBlocks] = useState<string[]>([])

  const doneRef = useRef(false)
  const pasteBlocksRef = useRef<string[]>([])
  const pasteTimestampRef = useRef(0)

  const finish = (value: string | null) => {
    if (doneRef.current) return
    doneRef.current = true
    const blocks = pasteBlocksRef.current
    const expanded = value?.replace(PASTE_MARKER_RE, (_, idxStr) => blocks[Number(idxStr)] ?? '') ?? null
    onDone(expanded)
    exit()
  }

  const handleEnter = () => {
    setBuffer((prev) => {
      if (globalThis.process?.env?.['MLDEBUG']) {
        globalThis.process.stderr.write(`\nMLDEBUG enter prev=${JSON.stringify(prev)}\n`)
      }
      if (prev.length === 0) return prev
      // Enter on an empty last line submits; otherwise Enter is a newline
      if (prev.endsWith('\n') || PASTE_MARKER_SINGLE_RE.test(prev.split('\n').pop() ?? '')) {
        const blocks = pasteBlocksRef.current
        const candidate = finalizeInput(prev).replace(PASTE_MARKER_RE, (_, idxStr) => blocks[Number(idxStr)] ?? '')
        if (candidate.trim().length > 0) {
          queueMicrotask(() => finish(finalizeInput(prev)))
          return prev
        }
        return prev
      }
      return prev + '\n'
    })
  }

  useInput((input, key) => {
    if (globalThis.process?.env?.['MLDEBUG']) {
      globalThis.process.stderr.write(`\nMLDEBUG input=${JSON.stringify(input)} return=${key.return}\n`)
    }
    // Detect paste: multi-character input containing newlines. Ink's key
    // parser garbles pasted text, so capture the whole paste as-is. Large
    // pastes may arrive in chunks; a short cooldown catches the trailing ones.
    const PASTE_COOLDOWN_MS = 100
    const isPasteCooldown = pasteTimestampRef.current > 0 && Date.now() - pasteTimestampRef.current < PASTE_COOLDOWN_MS

    if (isPastedInput(input) || (isPasteCooldown && input.length > 1)) {
      const cleaned = cleanPastedText(input)
      if (cleaned.length > 0) {
        if (isPasteCooldown && pasteBlocksRef.current.length > 0) {
          const lastIdx = pasteBlocksRef.current.length - 1
          pasteBlocksRef.current[lastIdx] += '\n' + cleaned
        } else {
          const idx = pasteBlocksRef.current.length
          pasteBlocksRef.current.push(cleaned)
          setBuffer((prev) => prev + `\x00PASTE_${idx}\x00`)
        }
        setPasteBlocks([...pasteBlocksRef.current])
      }
      pasteTimestampRef.current = Date.now()
      return
    }

    if (key.ctrl && input === 'c') {
      finish(null)
      return
    }
    if (key.return) {
      handleEnter()
      return
    }
    if (key.backspace || key.delete) {
      setBuffer((prev) => {
        if (prev.length === 0) return ''
        // Backspacing into a paste placeholder removes the whole block
        if (prev[prev.length - 1] === '\x00') {
          const markerStart = prev.lastIndexOf('\x00', prev.length - 2)
          if (markerStart >= 0) {
            const match = prev.slice(markerStart).match(PASTE_MARKER_SINGLE_RE)
            if (match) {
              pasteBlocksRef.current[Number(match[1])] = ''
              setPasteBlocks([...pasteBlocksRef.current])
              return prev.slice(0, markerStart)
            }
          }
        }
        return prev.slice(0, -1)
      })
      return
    }
    if (key.tab) {
      setBuffer((prev) => prev + '  ')
      return
    }
    if (input) setBuffer((prev) => prev + input)
  })

  // Buffer display with inline paste labels
  const bufferElements = useMemo(() => {
    const elements: React.ReactElement[] = []
    const re = new RegExp(PASTE_MARKER_RE.source, 'g')
    let lastIndex = 0
    let match
    let segKey = 0
    while ((match = re.exec(buffer)) !== null) {
      if (match.index > lastIndex) {
        elements.push(React.createElement(Text, { key: `t${segKey++}` }, buffer.slice(lastIndex, match.index)))
      }
      const block = pasteBlocks[Number(match[1])]
      if (block) {
        elements.push(
          React.createElement(
            Text,
            { key: `p${segKey++}`, color: 'yellow' },
            formatPasteLabel(block, Number(match[1])),
          ),
        )
      }
      lastIndex = match.index + match[0].length
    }
    if (lastIndex < buffer.length) {
      elements.push(React.createElement(Text, { key: `t${segKey++}` }, buffer.slice(lastIndex)))
    }
    return elements
  }, [buffer, pasteBlocks])

  return React.createElement(
    Box,
    { flexDirection: 'column' },
    React.createElement(Text, { color: 'cyan' }, message),
    React.createElement(
      Box,
      null,
      buffer.length === 0 && placeholder
        ? React.createElement(Text, null, CURSOR_BLOCK, React.createElement(Text, { color: 'gray' }, ` ${placeholder}`))
        : React.createElement(Text, null, ...bufferElements.map((e) => e), CURSOR_BLOCK),
    ),
    hint ? React.createElement(Text, { color: 'gray', dimColor: true }, hint) : null,
  )
}

const DEFAULT_HINT = 'Enter = newline. Empty line + Enter again = send. Paste multi-line blocks freely. Ctrl+C cancel.'

/**
 * Prompt for free text in the terminal. Returns the full text with pasted
 * blocks expanded inline, or null on cancel / non-TTY.
 */
export async function promptMultiline(options: MultilinePromptOptions): Promise<string | null> {
  const stdin = globalThis.process?.stdin
  const stdout = globalThis.process?.stdout
  if (!stdin || !stdout || !stdin.isTTY || !stdout.isTTY) return null

  return await new Promise<string | null>((resolve, reject) => {
    let settled = false
    const settle = (value: string | null) => {
      if (settled) return
      settled = true
      resolve(value)
    }

    const instance = render(
      React.createElement(MultilineTextPrompt, {
        ...options,
        hint: options.hint ?? DEFAULT_HINT,
        onDone: settle,
      }),
      { exitOnCtrlC: false, patchConsole: false, stdin, stdout },
    )

    instance
      .waitUntilExit()
      .then(() => settle(null))
      .catch((err) => {
        if (settled) return
        settled = true
        reject(err)
      })
  })
}
