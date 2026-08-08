import { createDocFromMarkdown, deleteFile, listDocSuggestions } from '#lib/google/mod.ts'
import { KeychainSecretsProvider } from '#lib/secrets/mod.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { resolveGoogleClient } from '../../lib/resolveClient.ts'
import { suggestDocsEdit } from './browserSuggestions.ts'

// Live end-to-end proof of the suggest chain: creates a real throwaway Doc in
// the account's Drive, types two suggestions through the automation browser
// (concurrently, to exercise the profile queue), reads them back via the Docs
// API, and deletes the doc — pass or fail. The e2e filename keeps it out of
// CI and every dev:test:* script; opt in explicitly:
//
//   SKY_GOOGLE_E2E=1 bun test commands/all/google/agent/lib/browserSuggestions_e2e_test.ts
//
// Needs stored OAuth (sky google:auth) and the signed-in automation browser
// (sky google:browser). With several stored accounts, pick one via
// SKY_GOOGLE_E2E_ACCOUNT=<email or unique part of it>.

const enabled = env.get('SKY_GOOGLE_E2E') === '1'

const TITLE = 'Sky suggest e2e (safe to delete)'
const MARKDOWN = [
  '# Sky suggest e2e',
  '',
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
  '',
  'The falcon rests beside the quiet harbor. The falcon rests beside the stormy harbor.',
].join('\n')

test(
  'suggestDocsEdit → listDocSuggestions round-trip on a throwaway doc',
  {
    skip: enabled ? false : 'set SKY_GOOGLE_E2E=1 to run (live Google account + signed-in automation browser)',
    timeout: 360_000,
  },
  async () => {
    const secrets = new KeychainSecretsProvider()
    const client = await resolveGoogleClient({
      secrets,
      requested: env.get('SKY_GOOGLE_E2E_ACCOUNT') || undefined,
      interactive: false,
    })
    const doc = await createDocFromMarkdown(client, { title: TITLE, markdown: MARKDOWN })
    try {
      // Deliberately concurrent: the profile queue must serialize what used
      // to collide (two launches on one Chromium profile).
      await Promise.all([
        suggestDocsEdit({
          documentId: doc.id,
          searchText: 'consectetur adipiscing elit',
          replacement: 'consectetur tempor elit',
        }),
        suggestDocsEdit({
          documentId: doc.id,
          searchText: 'rests beside the',
          replacement: 'rests gently beside the',
          occurrence: 2,
        }),
      ])

      // The Docs API can lag the editor by a moment — poll briefly.
      let suggestions = await listDocSuggestions(client, doc.id)
      for (let i = 0; i < 3 && suggestions.length < 2; i++) {
        await new Promise((resolve) => setTimeout(resolve, 2000))
        suggestions = await listDocSuggestions(client, doc.id)
      }

      assert({
        given: 'two concurrent suggest flows on one doc',
        should: 'land exactly two pending suggestions',
        expected: 2,
        actual: suggestions.length,
      })

      const swap = suggestions.find((s) => s.inserts === 'tempor')
      assert({
        given: 'a word-swap suggestion (shared prefix and suffix trimmed)',
        should: 'strike exactly the old word and insert the new one at its anchor',
        expected: { deletes: 'adipiscing', inserts: 'tempor', anchored: true },
        actual: swap && {
          deletes: swap.deletes,
          inserts: swap.inserts,
          anchored: swap.context.includes('consectetur'),
        },
      })

      const insertion = suggestions.find((s) => s.inserts === 'gently ')
      assert({
        given: 'a pure insertion targeting occurrence 2 of a repeated phrase',
        should: 'delete nothing and land in the second sentence (after the quiet one)',
        expected: { deletes: '', inserts: 'gently ', afterFirstSentence: true },
        actual: insertion && {
          deletes: insertion.deletes,
          inserts: insertion.inserts,
          afterFirstSentence: insertion.context.includes('quiet'),
        },
      })
    } finally {
      await deleteFile(client, doc.id)
    }
  },
)
