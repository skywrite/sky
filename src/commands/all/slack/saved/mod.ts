import { Command, type CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { type PileResult, runPile } from './lib/pile.ts'

const params = {
  channel: Flag.string(
    'Filter by #channel, @person, exact group participants, or conversation ID; supports * (quote patterns)',
    {
      optional: true,
    },
  ),
  sort: Flag.string('Sort by: time (oldest first) or channel (group by conversation)', { default: 'time' }),
  all: Flag.bool('Show every fetched matching item (still subject to --limit)', { default: false }),
  captureAll: Flag.bool('Capture every fetched matching item (still subject to --limit)', { default: false }),
  captureBatch: Flag.number('Capture the first N matched items in the selected sort order (repeat for the next N)', {
    short: 'n',
  }),
  open: Flag.stringOrBool(
    'Open items in Slack: bare --open opens what a capture run lands; --open=3 alone opens the first 3 matched read-only',
    { bareValue: 'landed' },
  ),
  limit: Flag.number('Max saved items to fetch from Slack', { default: 600 }),
  includeUnavailable: Flag.bool('Show saved items whose channels are unavailable', { default: false }),
}

type Params = InferParams<typeof params>

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'slack:saved': { params: Params; result: PileResult }
  }
}

export default class SlackSavedTask extends Command {
  static override description: CommandDescription = {
    name: 'slack:saved',
    description: "List Slack's Saved section (oldest-first by default), and optionally capture items.",
    descriptionLong: [
      "Shows the head of Slack's Saved section — the first 20 available items,",
      'oldest origin message first by default (--sort time), whatever the day.',
      'Saved is the pile Slack keeps for context; the to-dos, the pile that',
      'wants an action from you, are slack:todos.',
      '--all shows every fetched matching item; --limit controls how many items',
      'are fetched from Slack (default 600).',
      '--sort channel groups by conversation: channels first, then people,',
      'alphabetically, with oldest messages first within each conversation.',
      'Listing, batch capture, and open all follow the selected sort order;',
      'grouping is applied before the listing limit. The header line carries',
      'the full count of the Saved section. Listing is read-only; slack:saved:day is the',
      'day-scoped view of the same pile.',
      'Unavailable channels are hidden by default; --include-unavailable shows',
      'them too, within the same listing limit. They remain in the pile.',
      '--channel scopes listing, capture, and open identically: #name matches',
      'only channels; @person matches only one-to-one DMs. Comma-separated',
      'names match exactly those other group participants, in any order.',
      'People match display names, full names, or handles. Bare names search',
      'all conversation types. Matching ignores case and surrounding spaces;',
      '* explicitly allows partial names and multiple conversations. Quote',
      "patterns, e.g. --channel '#atlas-*'. Ambiguous exact names require a",
      'prefix or conversation ID. Raw group-DM slugs also remain supported.',
      'Counts and ambiguity checks cover fetched items (--limit).',
      '',
      '--capture-batch N captures the first N through slack:follow:message: live',
      'threads are captured AND followed for new replies; threads quiet past',
      'the follow expiry window archive without a follow. A thread captured',
      'before gets only its new replies, and an archived one that has come',
      'back to life is followed again. Summary, auto-tags, and auto-rel apply',
      'either way, each item is then marked complete in Slack, and captured',
      'files open in the editor when done.',
      '--capture-all captures every available matching item in this fetch,',
      'in the selected sort order. Use --limit to increase the fetch size.',
      '',
      'Bare --open on a capture run also opens each item the run lands in',
      'Slack — captured threads and already-captured skips alike, since those',
      'are the ones most likely still waiting on a reply. --open=N alone opens',
      'the first N read-only before any capturing: nothing completes, so the',
      'items keep their Saved badge in Slack.',
      '',
      'Completed items drop off the list, so the same command run again takes',
      'the next N — drain the backlog a batch at a time, checking tags between',
      'runs, or use --capture-all to capture every fetched match at once.',
    ],
    usage: [
      'sky slack:saved',
      'sky slack:saved --all',
      'sky slack:saved --sort channel',
      'sky slack:saved --sort channel --all',
      'sky slack:saved --sort channel --capture-batch 5',
      'sky slack:saved --channel atlas',
      "sky slack:saved --channel '@Jane*'",
      "sky slack:saved --channel 'Jane Doe, John Roe'",
      "sky slack:saved --channel '#atlas-*' --all",
      "sky slack:saved --channel '#atlas-*' --capture-batch 5",
      "sky slack:saved --channel '#atlas-*' --capture-all",
      'sky slack:saved --channel atlas --capture-batch 5',
      'sky slack:saved --include-unavailable',
      'sky slack:saved --capture-batch 5',
      'sky slack:saved -n 5 --open',
      'sky slack:saved --open=3',
    ],
    params,
  }

  async run({ args, context, tasks }: CommandArgs<Params>): Promise<CommandResult<PileResult>> {
    return runPile(
      { view: 'saved', command: 'slack:saved', noun: 'Saved', slackAction: 'Add to saved', defaultSort: 'time' },
      args,
      {
        context,
        tasks,
      },
    )
  }
}
