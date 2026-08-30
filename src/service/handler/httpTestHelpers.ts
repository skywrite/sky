import * as path from 'node:path'
import type { YogaServerInstance } from 'graphql-yoga'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { Store } from '../store.ts'
import type { ChatRoutesOptions } from './chat/mod.ts'
import { createHttpApp } from './http.ts'

function createTestYoga(): YogaServerInstance<object, object> {
  return {
    handleRequest: async () =>
      new Response('{}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  } as unknown as YogaServerInstance<object, object>
}

export function createTestHttpApp(
  markdownDirs: string[],
  options: { markdownStore?: MarkdownStore | null; chat?: ChatRoutesOptions; userDataDir?: string } = {},
) {
  const markdownBaseDir = path.join(markdownDirs[0]!, '..')
  return createHttpApp({
    store: new Store(),
    yoga: createTestYoga(),
    markdownStore: options.markdownStore ?? null,
    markdownBaseDir,
    markdownDirs,
    chat: options.chat,
    // Never the real user-data directory: what a test stores stays in its temp notebook.
    userDataDir: options.userDataDir ?? path.join(markdownBaseDir, '.user-data'),
  })
}
