import * as path from 'node:path'
import type { YogaServerInstance } from 'graphql-yoga'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { Store } from '../store.ts'
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

export function createTestHttpApp(markdownDirs: string[], options: { markdownStore?: MarkdownStore | null } = {}) {
  const markdownBaseDir = path.join(markdownDirs[0]!, '..')
  return createHttpApp({
    store: new Store(),
    yoga: createTestYoga(),
    markdownStore: options.markdownStore ?? null,
    markdownBaseDir,
    markdownDirs,
  })
}
