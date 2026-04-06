import colors from 'picocolors'
import type { CommandDescription } from './commands.d.ts'
import type { ParamDef } from './params.ts'

const boldRed = (val: string) => colors.bold(colors.red(val))

export default function helpMessage(commandDesc: CommandDescription): string {
  return paramsHelpMessage(commandDesc)
}

/**
 * Generate help message from new params format
 */
function paramsHelpMessage(commandDesc: CommandDescription): string {
  const params = commandDesc.params ?? {}
  const args: string[] = []
  const flags: string[] = []

  // Separate into args and flags, calculate padding
  const argEntries: Array<[string, ParamDef]> = []
  const flagEntries: Array<[string, ParamDef]> = []

  for (const [name, param] of Object.entries(params)) {
    if (param.hidden) continue

    if (param.kind === 'arg' || param.kind === 'arg-or-flag') {
      argEntries.push([name, param])
    } else {
      flagEntries.push([name, param])
    }
  }

  // Calculate padding
  let pLen = 0
  for (const [name, param] of argEntries) {
    let display: string
    if (param.kind === 'arg-or-flag') {
      display = `<${name}> or ${formatFlagName(name, param)}`
    } else {
      display = `<${name}>`
    }
    if (display.length > pLen) pLen = display.length
  }
  for (const [name, param] of flagEntries) {
    const display = formatFlagName(name, param)
    if (display.length > pLen) pLen = display.length
  }

  // Format args
  for (const [name, param] of argEntries) {
    let display: string
    if (param.kind === 'arg-or-flag') {
      // Show both positional and flag format
      const flagPart = formatFlagName(name, param)
      display = `<${name}> or ${flagPart}`
    } else {
      display = `<${name}>`
    }
    display = display.padEnd(pLen)
    const required = isRequired(param) ? boldRed('[REQUIRED]') : ''
    args.push(`  ${display}  ${param.description} ${required}`.trimEnd())
  }

  // Format flags
  for (const [name, param] of flagEntries) {
    const display = formatFlagName(name, param).padEnd(pLen)
    const required = isRequired(param) ? boldRed('[REQUIRED]') : ''
    flags.push(`  ${display}  ${param.description} ${required}`.trimEnd())
  }

  const argsMessage = '<arguments> <flags>'
  const taskMessage = `  sky ${commandDesc.name} ${argsMessage}`

  const message = [colors.blue('\nUsage:'), taskMessage, '', '  ' + colors.bold(commandDesc.description)]

  if (commandDesc.descriptionLong && commandDesc.descriptionLong.length > 0) {
    message.push('')
    // Join with spaces, but empty strings become newlines (paragraph breaks)
    const paragraphs: string[] = []
    let current: string[] = []
    for (const line of commandDesc.descriptionLong) {
      if (line === '') {
        if (current.length > 0) {
          paragraphs.push(current.join(' '))
          current = []
        }
      } else {
        current.push(line)
      }
    }
    if (current.length > 0) {
      paragraphs.push(current.join(' '))
    }
    message.push(paragraphs.map((p) => '  ' + p).join('\n\n'))
  }

  if (commandDesc.usage && commandDesc.usage.length > 0) {
    message.push(colors.cyan('\nExamples:'))
    for (const example of commandDesc.usage) {
      message.push(`  ${example}`)
    }
  }

  if (args.length > 0) {
    message.push(colors.green('\nArguments:'))
    message.push(...args)
  }

  if (flags.length > 0) {
    message.push(colors.yellow('\nFlags:'))
    message.push(...flags)
  }

  message.push('')
  return message.join('\n')
}

function formatFlagName(name: string, param: ParamDef): string {
  const short = param.short ? `-${param.short}, ` : ''
  const long = `--${camelToKebab(name)}`
  return `${short}${long}`
}

function camelToKebab(str: string): string {
  return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
}

function isRequired(param: ParamDef): boolean {
  return !param.optional && param.default === undefined
}
