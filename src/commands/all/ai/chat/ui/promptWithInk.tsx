import { render } from 'ink'
import React from 'react'
import { ChatInputPrompt } from './ChatInputPrompt.tsx'
import type { ChatPromptOptions, ChatPromptResult } from './types.ts'

const DEFAULT_HINT =
  'Enter = newline. Empty line + Enter again = send. Ctrl+S save. Ctrl+L log. Ctrl+B split context. Arrows move tree. Left/Right collapse/expand. Click folder triangle to toggle.'

export async function promptWithInk({
  placeholder,
  hint,
  topic,
  saveOnExit,
  logToDay,
  splitViewEnabled,
  contextScrollOffset,
  conversation,
  contextFiles,
  summarizePaste,
}: ChatPromptOptions): Promise<ChatPromptResult> {
  const stdin = globalThis.process?.stdin
  const stdout = globalThis.process?.stdout
  if (!stdin || !stdout || !stdin.isTTY || !stdout.isTTY) {
    return { message: null, saveOnExit, logToDay, splitViewEnabled, contextScrollOffset }
  }

  // Enter alternate screen buffer so Ink's aggressive terminal clearing
  // (ansiEscapes.clearTerminal includes \x1b[3J which wipes scrollback)
  // doesn't destroy the chat history visible in the main buffer.
  stdout.write('\x1b[?1049h')

  try {
    return await new Promise<ChatPromptResult>((resolve, reject) => {
      let settled = false
      const settle = (value: ChatPromptResult) => {
        if (settled) return
        settled = true
        resolve(value)
      }

      const instance = render(
        React.createElement(ChatInputPrompt, {
          placeholder: placeholder ?? 'Type your message...',
          hint: hint ?? DEFAULT_HINT,
          topic,
          saveOnExit,
          logToDay,
          splitViewEnabled,
          contextScrollOffset,
          conversation,
          contextFiles,
          summarizePaste,
          onDone: settle,
        }),
        {
          exitOnCtrlC: false,
          patchConsole: false,
          stdin,
          stdout,
        },
      )

      instance
        .waitUntilExit()
        .then(() => settle({ message: null, saveOnExit, logToDay, splitViewEnabled, contextScrollOffset }))
        .catch((err) => {
          if (settled) return
          settled = true
          reject(err)
        })
    })
  } finally {
    // Leave alternate screen buffer — restores the main buffer with
    // scrollback history intact.
    stdout.write('\x1b[?1049l')
  }
}
