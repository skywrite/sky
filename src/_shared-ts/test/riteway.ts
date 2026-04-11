/// <reference path="./node-util.d.ts" />
import { deepStrictEqual } from 'node:assert'
import { styleText } from 'node:util'
import * as diff from 'diff'

// inspiration: https://github.com/ericelliott/riteway

export interface Assertion<T> {
  readonly given?: string
  readonly should?: string
  readonly actual: T
  readonly expected: T
}

export function assert<T>(assertion: Assertion<T>): void {
  const { given, should, actual, expected } = assertion

  let msgPrefix = ''
  if (should || given) {
    const msg = `Given ${given || '(no context)'}: should ${should || '(no expectation)'}`
    msgPrefix = `\n\n${styleText(['bgRed', 'white'], msg)}\n`
  }

  const fatStrings =
    typeof actual === 'string' && actual.includes('\n') && typeof expected === 'string' && expected.includes('\n')

  let msgBody = ''

  if (!fatStrings) {
    msgBody = [
      '',
      styleText(['bold', 'cyan'], '  EXPECTED: ') + styleText('green', stringifyVal(expected)),
      styleText(['bold', 'cyan'], '  ACTUAL:   ') + styleText('red', stringifyVal(actual)),
      '',
    ].join('\n')
  } else {
    const differences = diff.diffChars(expected as string, actual as string)

    for (const part of differences) {
      if (part.added) {
        if (part.value.trim() === '') {
          // Whitespace addition
          msgBody += styleText(['bgGreen', 'white'], visualizeWhitespace(part.value))
        } else {
          msgBody += styleText('green', visualizeWhitespace(part.value))
        }
      } else if (part.removed) {
        if (part.value.trim() === '') {
          // Whitespace removal
          msgBody += styleText(['bgRed', 'white'], visualizeWhitespace(part.value))
        } else {
          msgBody += styleText('red', visualizeWhitespace(part.value))
        }
      } else {
        // Unchanged parts
        msgBody += styleText('gray', part.value)
      }
    }
  }

  deepStrictEqual(actual, expected, msgPrefix + msgBody)
}

function stringifyVal(val: unknown): string {
  if (typeof val === 'object') return JSON.stringify(val, null, 2)
  return String(val)
}

function visualizeWhitespace(str: string): string {
  return str.replace(/ /g, '·').replace(/\t/g, '→   ').replace(/\n/g, '↵\n')
}
