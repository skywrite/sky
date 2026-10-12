---
created: 2026-10-12
updated: 2026-10-12
---

# The client build's retry leaves with Bun's resolver fix

## The problem

`src/web/bundle.ts` builds the web client with `Bun.build`, once per
process, on the first request for its JavaScript. Under `bun test`, the
runner's scan for test files leaves cached folder handles read to their
end, and the first build to re-read one of those folders sees it empty and
reports its files as unresolvable (`Could not resolve:
"../editor/markdownEditor.tsx"`, for a file that is there). A race decides
which runs hit it: about half of them since the client moved into one
folder per feature (3cd27ac8), and the bundle test and the first browser
test of a CI run went red with it on 2026-10-11. The running app builds
outside the test runner and is not affected.

This is Bun's bug, not ours: oven-sh/bun#22941, traced by the Bun team in
July 2026. The fix is their PR #36245, seven lines that rewind the reused
handle before reading it. As of Bun 1.4.3 (2026-10-10) it has not been
merged, so no Bun version fixes it yet.

## The workaround in place

Since 00ca0979 (2026-10-12), `buildAssets` tries a build once more when its
only errors are unresolved files (`ResolveMessage`s). The failed read drops
the bad handle, so the second build reads the folder from disk. Any other
build error is reported on the first build, as before. Measured on the
bundle test in CI's scan mode: 12 of 12 runs green, 7 misses recovered; a
syntax error still builds once.

## The shape of the fix

When a Bun release carries #36245, or an equivalent, and the repo moves to
it (the version is pinned in `.github/workflows/tests.yml`; moving is its
own decision, with startup time measured first):

1. Delete `unresolvedOnly` and the retrying `build` in `src/web/bundle.ts`,
   so `once` is the build again.
2. Check it the way CI runs it, in scan mode with an empty home folder, a
   dozen times from `src/`: `HOME=$(mktemp -d) bun test web/bundle_test.ts`.
   On a Bun without the fix, about half of these runs fail once the retry
   is gone.

## What the workaround trades meanwhile

A genuinely missing import is built twice before it is reported: a second
or two in the development loop, in a case that is rare. Nothing else; the
running app never takes the second build.
