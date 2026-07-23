// Keep the command-palette titles' model name in sync with the AI registry.
//
// contributes.commands[].title is static manifest data — VS Code offers no
// runtime retitling — so the model id must be baked into package.json. This
// script re-bakes it from the registry: run bare to rewrite the manifest,
// or with --check (part of `npm run check`) to fail when a role repoint has
// left the titles stale.
import { readFileSync, writeFileSync } from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { aiModelId } from '#shared/ai/models.ts'

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST = path.join(EXT, 'package.json')

// command id -> title template; {model} is the registry's reasoning model id.
// attachment.* shell out to `sky summary:doc`, whose default profile is also
// the reasoning role, so one registry entry governs all three.
const TITLES: Record<string, string> = {
  'transcript.summarize': 'Summarize Transcript ({model})',
  'attachment.summarize': 'Summarize Attachment ({model})',
  'attachment.summarizeAll': 'Summarize All Attachments ({model})',
}

const model = aiModelId('reasoning')
const check = process.argv.includes('--check')
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
const commands: Array<{ command: string; title: string }> = manifest.contributes?.commands ?? []

let stale = 0
for (const cmd of commands) {
  const template = TITLES[cmd.command]
  if (!template) continue
  const want = template.replace('{model}', model)
  if (cmd.title === want) continue
  console.log(`${check ? 'STALE ' : 'sync  '} ${cmd.command}: "${cmd.title}" -> "${want}"`)
  cmd.title = want
  stale++
}

if (stale === 0) {
  console.log(`syncTitles: titles in sync (${model})`)
} else if (check) {
  console.log(`\nsyncTitles: ${stale} stale title(s) — run \`node scripts/syncTitles.ts\`, then reload the window`)
  process.exit(1)
} else {
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n')
  console.log(`syncTitles: ${stale} title(s) updated (${model}) — reload the window to see them`)
}
