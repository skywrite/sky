import * as path from 'node:path'
import type { YogaServerInstance } from 'graphql-yoga'
import { Store } from '../store.ts'
import { createHttpApp } from './http.ts'

const STATIC_DIR = new URL('../client', import.meta.url).pathname

function createTestYoga(): YogaServerInstance<object, object> {
  return {
    handleRequest: async () =>
      new Response('{}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  } as unknown as YogaServerInstance<object, object>
}

export function createTestHttpApp(markdownDirs: string[]) {
  const markdownBaseDir = path.join(markdownDirs[0]!, '..')
  return createHttpApp({
    store: new Store(),
    yoga: createTestYoga(),
    markdownStore: null,
    staticDir: STATIC_DIR,
    markdownBaseDir,
    markdownDirs,
  })
}
