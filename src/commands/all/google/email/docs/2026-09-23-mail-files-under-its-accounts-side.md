---
created: 2026-09-23
updated: 2026-09-23
---

# Mail files under its account's side of the day

## The problem

The Gmail sync saves followed mail from every connected account.
Each new capture adds an entry to the day's Complete list through `email:new`.
The capture never passed a category, so `email:new` used its default: Professional.
Mail from a personal account landed in Professional Complete, beside work.

## What changed

- The Google settings page has a card, "Professional or personal".
  It has one row per connected account, each with a Professional / Personal choice.
- The choice lives in `config.jsonc` as `google.accountCategories`.
  Its keys are the accounts' emails in lower case.
- The capture reads the choice for the account it runs under.
  It passes that choice to `email:new`, so the entry goes under that side's Complete list.
- An account nobody chose for files as Professional, as before.
- The Advanced settings view lists the choices under a Google section.
  Each row's source comes from its own key path, because an email contains dots.

## What it does not change

- Only a new day entry follows the choice.
  A message that continues a thread's file for the day adds no entry.
- Entries already written stay where they are.
- Slack, Beeper and chat logs still file as Professional.

## Why the choice lives in config.jsonc

It is a preference a person can read and edit by hand.
Its key is a readable email, unlike Beeper's opaque account ids, which live in Beeper's state file.
The capture reads the file each time it runs, so a change applies without a restart.

## Verified

- Unit tests cover the loader, the account lookup, the settings route, the Advanced view, and the capture handing the category to `email:new`.
- The Google page's browser test covers the new card with a synthetic account.
  It shows Professional before a choice, saves Personal once, and reads Personal back after a reload.
  It also checks that the page fits a phone.
- No test wrote to a real notebook or config file.
