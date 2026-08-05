import * as path from 'node:path'
import colors from 'picocolors'
import { Flag, type InferParams } from '#commands/lib/params.ts'
import { Command, CommandResult } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription } from '#commands/mod.ts'
import { walk } from '#shared/fs/mod.ts'
import MarkdownStore from '#shared/models/Markdown/Store/mod.ts'

const params = {
  count: Flag.boolean('Print only the count of orphan files', { default: false }),
  files: Flag.boolean('Print raw file paths (one per line)', { default: false }),
}

type Params = InferParams<typeof params>

interface TreeNode {
  name: string
  files: string[]
  dirs: Map<string, TreeNode>
}

function newNode(name: string): TreeNode {
  return { name, files: [], dirs: new Map() }
}

function insertPath(root: TreeNode, relPath: string): void {
  const parts = relPath.split('/')
  const fileName = parts.pop()!
  let node = root
  for (const part of parts) {
    if (!node.dirs.has(part)) {
      node.dirs.set(part, newNode(part))
    }
    node = node.dirs.get(part)!
  }
  node.files.push(fileName)
}

function countFiles(node: TreeNode): number {
  let count = node.files.length
  for (const child of node.dirs.values()) {
    count += countFiles(child)
  }
  return count
}

function printTree(node: TreeNode, log: (msg: string) => void, prefix: string, isLast: boolean, isRoot: boolean): void {
  const sortedDirs = [...node.dirs.entries()].sort(([a], [b]) => a.localeCompare(b))
  const sortedFiles = [...node.files].sort()
  const children: Array<{ type: 'dir'; name: string; node: TreeNode } | { type: 'file'; name: string }> = []

  for (const [name, child] of sortedDirs) {
    children.push({ type: 'dir', name, node: child })
  }
  for (const name of sortedFiles) {
    children.push({ type: 'file', name })
  }

  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    const last = i === children.length - 1
    const connector = last ? '└── ' : '├── '
    const nextPrefix = prefix + (last ? '    ' : '│   ')

    if (child.type === 'dir') {
      const count = countFiles(child.node)
      log(`${prefix}${connector}${colors.blue(child.name + '/')} ${colors.dim(`(${count})`)}`)
      printTree(child.node, log, nextPrefix, last, false)
    } else {
      log(`${prefix}${connector}${child.name}`)
    }
  }
}

export default class MarkdownOrphansTask extends Command {
  static override description: CommandDescription = {
    name: 'markdown:orphans',
    description: 'Find markdown files on disk that are not indexed by MarkdownStore.',
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult> {
    const { config, output } = context

    output.log('Building MarkdownStore...')
    const store = await MarkdownStore.buildFromAll()

    output.log(`Walking ${config.DIR_BASE}...`)

    const orphans: string[] = []

    for await (const entry of walk(config.DIR_BASE, { exts: ['.md'] })) {
      if (!entry.isFile) continue
      if (!store.findByPath(entry.path)) {
        orphans.push(path.relative(config.DIR_BASE, entry.path))
      }
    }

    if (args.count) {
      output.log(String(orphans.length))
      return CommandResult.success()
    }

    if (args.files) {
      for (const rel of orphans) {
        output.log(rel)
      }
      return CommandResult.success()
    }

    output.log('')
    if (orphans.length === 0) {
      output.log('No orphan files found.')
      return CommandResult.success()
    }

    output.log(`Found ${colors.yellow(String(orphans.length))} orphan file(s):\n`)

    const root = newNode('')
    for (const rel of orphans) {
      insertPath(root, rel)
    }

    printTree(root, (msg) => output.log(msg), '', true, true)

    return CommandResult.success()
  }
}
