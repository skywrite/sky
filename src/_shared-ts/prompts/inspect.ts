import Handlebars from 'handlebars'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import type { PreviewVariable } from './catalogTypes.ts'
import { getVariableDefinition } from './variables.ts'

// These are synthetic values; preview never loads the notebook or the user's profile.
const SAMPLES: Record<string, string | boolean | number> = {
  'user.input': 'Review the Atlas brief and identify the next steps.',
  'me.firstName': 'Jane',
  'me.lastName': 'Doe',
  'me.fullName': 'Jane Doe',
  'recipient.firstName': 'Alex',
  'recipient.name': 'Alex Example',
  'thread.summary': 'The team asked for a short brief before the next review.',
  'context.notebookDate': '2030-04-05',
  'context.systemDate': '2030-04-05',
  'context.notebookDay': 'Friday',
  'context.notebookTime': '14:00',
  'context.systemTime': '14:00',
  'context.notebookTimezone': 'America/Chicago',
  'context.systemTimezone': 'America/Chicago',
}

interface AstNode {
  type: string
  original?: string
  parts?: string[]
  data?: boolean
  path?: AstNode
  params?: AstNode[]
  hash?: { pairs: Array<{ value: AstNode }> }
  program?: AstNode
  inverse?: AstNode
  body?: AstNode[]
  blockParams?: string[]
}

/** Top-level context paths, including paths used only in conditionals and scoped loops. */
export function inspectVariables(body: string): PreviewVariable[] {
  const found = new Map<string, PreviewVariable>()
  function add(
    node: AstNode | undefined,
    scope: string | null,
    aliases: Map<string, string>,
    conditional: boolean,
    kind?: PreviewVariable['kind'],
  ) {
    if (node?.type !== 'PathExpression' || node.data) return
    let name = node.original ?? ''
    if (name.startsWith('@') || name === '') return
    if (name.startsWith('../')) {
      name = name.replace(/^(\.\.\/)+/, '')
      scope = null
    }
    const first = name.split('.')[0]!
    if (aliases.has(first)) name = aliases.get(first)! + name.slice(first.length)
    else if (scope) name = name === 'this' ? scope : `${scope}.${name.replace(/^this\./, '')}`
    else if (name === 'this' || name.startsWith('this.')) return
    // An each/with input is edited as one JSON value, including its scoped fields.
    if ([...found.values()].some((field) => field.kind === 'json' && name.startsWith(`${field.name}.`))) return
    if (name.split('.').some((part) => ['__proto__', 'constructor', 'prototype'].includes(part))) return
    const definition = getVariableDefinition(name)
    const previous = found.get(name)
    const resolvedKind =
      kind ||
      previous?.kind ||
      (definition?.type === 'boolean'
        ? 'boolean'
        : definition?.type === 'number'
          ? 'number'
          : definition?.type === 'array'
            ? 'json'
            : 'text')
    found.set(name, {
      name,
      kind: resolvedKind,
      description: definition?.description || 'Context supplied by the caller',
      conditional: previous ? previous.conditional && conditional : conditional,
      sample:
        SAMPLES[name] ??
        (resolvedKind === 'boolean' ? true : resolvedKind === 'number' ? 1 : resolvedKind === 'json' ? '[]' : ''),
    })
  }
  function expression(node: AstNode, scope: string | null, aliases: Map<string, string>, conditional: boolean) {
    if (node.type === 'PathExpression') add(node, scope, aliases, conditional)
    else if (node.type === 'SubExpression') {
      node.params?.forEach((param) => expression(param, scope, aliases, conditional))
      node.hash?.pairs.forEach((pair) => expression(pair.value, scope, aliases, conditional))
    }
  }
  function visit(
    program: AstNode | undefined,
    scope: string | null,
    aliases: Map<string, string>,
    conditional: boolean,
  ) {
    for (const node of program?.body || []) {
      if (node.type === 'MustacheStatement') {
        if (!node.params?.length && !node.hash?.pairs.length) add(node.path, scope, aliases, conditional)
        node.params?.forEach((param) => expression(param, scope, aliases, conditional))
        node.hash?.pairs.forEach((pair) => expression(pair.value, scope, aliases, conditional))
      } else if (node.type === 'BlockStatement') {
        const helper = node.path?.original
        const collection = helper === 'each' || helper === 'with'
        const parameter = node.params?.[0]
        node.params?.forEach((param) =>
          collection ? add(param, scope, aliases, true, 'json') : expression(param, scope, aliases, true),
        )
        if (!node.params?.length && helper && !['if', 'unless', 'else'].includes(helper))
          add(node.path, scope, aliases, true)
        const nested = new Map(aliases)
        const local =
          collection && parameter?.original ? (scope ? `${scope}.${parameter.original}` : parameter.original) : scope
        if (local && node.program?.blockParams?.[0]) nested.set(node.program.blockParams[0], local)
        visit(node.program, local, nested, true)
        visit(node.inverse, scope, aliases, true)
      }
    }
  }
  visit(Handlebars.parse(body) as AstNode, null, new Map(), false)
  return [...found.values()]
}

export function previewContext(fields: PreviewVariable[], values: Record<string, unknown>): Record<string, unknown> {
  const context: Record<string, unknown> = Object.create(null)
  for (const field of fields) {
    const parts = field.name.split('.')
    if (parts.some((part) => ['__proto__', 'constructor', 'prototype'].includes(part)))
      throw new Error('Invalid variable path')
    let target = context
    for (const part of parts.slice(0, -1)) {
      if (!target[part] || typeof target[part] !== 'object') target[part] = Object.create(null)
      target = target[part] as Record<string, unknown>
    }
    const value = Object.hasOwn(values, field.name) ? values[field.name] : field.sample
    target[parts.at(-1)!] = field.kind === 'json' && typeof value === 'string' ? JSON.parse(value || 'null') : value
  }
  const runtime = context.context as Record<string, unknown> | undefined
  if (typeof runtime?.notebookDate === 'string') {
    try {
      runtime.notebookDay = new PlainDate(runtime.notebookDate).dayLong
    } catch {
      /* Keep an invalid sample visible. */
    }
  }
  return context
}
