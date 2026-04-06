# Contributing to Sky

Thanks for your interest in contributing. Sky is a personal operating system built on plaintext markdown — contributions that make it better for everyone are welcome.

## Before you start

**Open an issue first.** Before writing code, open a GitHub issue describing what you want to change and why. This saves everyone time — some areas of the codebase have strong opinions baked in, and it's better to align on approach before you write a PR that needs a full rethink.

Bug reports can go straight to a PR if the fix is obvious and small.

## Pull requests

### Keep them small

Ideal PRs are under 50 lines of changed code. If your change is bigger, break it into smaller, reviewable pieces. A series of small PRs lands faster than one large PR that sits in review.

### Requirements

- Passes all code quality checks (formatting, linting, typechecking)
- Includes tests for new behavior
- References the GitHub issue it addresses
- Has a clear description of what changed and why

### Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(day): add sunrise time to day:start output
fix(nbfs): handle cross-year week directories
refactor(markdown): simplify frontmatter parser
```

### What to expect

Every PR gets reviewed. Response times vary — this is a side project. If something is unclear or needs changes, you'll get direct feedback. Don't take it personally; the goal is to keep the codebase clean and consistent.

## What makes a good contribution

- Bug fixes with a regression test
- Performance improvements with benchmarks
- New commands that follow existing patterns
- Documentation fixes
- Test coverage for untested code paths

## Questions?

Open a GitHub issue. That's it — no Discord, no Slack. Issues keep everything searchable and public.
