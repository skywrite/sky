export { default as exists } from './exists.ts'
export { default as makeTempDir } from './makeTempDir.ts'
export { default as outputFile } from './outputFile.ts'
export { default as readDir, type DirEntry } from './readDir.ts'
export { default as readDirSync } from './readDirSync.ts'
export { default as readTextFile } from './readTextFile.ts'
export { default as readTextFileSync } from './readTextFileSync.ts'
export { default as rename } from './rename.ts'
export { default as walk, type WalkEntry, type WalkOptions } from './walk.ts'
export { default as walkToArray } from './walkToArray.ts'
export { default as writeTextFile } from './writeTextFile.ts'

// NOTE: watchFs is intentionally NOT exported from this barrel.
// It lives in ./watch.ts and must be imported directly: `import { watchFs } from '#shared/fs/watch.ts'`
// Reason: watchFs pulls in chokidar, which uses node:events and node:stream. The VSCode extension
// bundles this module via webpack, and webpack can't handle those node: imports. Keeping watchFs
// out of the barrel prevents it from being pulled into the extension bundle via tree-shaking failure.
