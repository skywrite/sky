import { type PileResult, runPile } from '#commands/all/slack/saved/lib/pile.ts'
import { Command, type CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'

const params = {
  channel: Flag.string(
    'Filter by #channel, @person, exact group participants, or conversation ID; supports * (quote patterns)',
    {
      optional: true,
    },
  ),
  sort: Flag.string('Sort by: due (soonest reminder first), time (oldest first), or channel (group by conversation)', {
    default: 'due',
  }),
  dueWithin: Flag.string('Only to-dos due by then: 30m, 12h, 2d, tomorrow, monday (overdue ones included)', {
    optional: true,
  }),
  all: Flag.bool('Show every fetched matching to-do (still subject to --limit)', { default: false }),
  captureAll: Flag.bool('Capture every fetched matching to-do (still subject to --limit)', { default: false }),
  captureBatch: Flag.number('Capture the first N matched to-dos in the selected sort order (repeat for the next N)', {
    short: 'n',
  }),
  open: Flag.stringOrBool(
    'Open to-dos in Slack: bare --open opens what a capture run lands; --open=3 alone opens the first 3 matched read-only',
    { bareValue: 'landed' },
  ),
  limit: Flag.number('Max to-dos to fetch from Slack', { default: 600 }),
  includeUnavailable: Flag.bool('Show to-dos whose channels are unavailable', { default: false }),
}

type Params = InferParams<typeof params>

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'slack:todos': { params: Params; result: PileResult }
  }
}

export default class SlackTodosTask extends Command {
  static override description: CommandDescription = {
    name: 'slack:todos',
    description: "List Slack's To-dos (soonest due first by default), and optionally capture them.",
    descriptionLong: [
      "Shows the head of Slack's To-dos tab — the first 20 available to-dos,",
      'soonest reminder first by default (--sort due; overdue ones marked red),',
      'oldest origin message first with --sort time, or grouped by conversation',
      'with --sort channel. A to-do is a message you marked in Slack as wanting',
      'an action from you; the Saved section, kept for context, is slack:saved.',
      '--due-within narrows the list to to-dos due by then (30m, 12h, 2d,',
      'tomorrow, monday), overdue ones included. --all shows every fetched',
      'match; --limit controls how many to-dos are fetched from Slack (default 600).',
      'Unavailable channels are hidden by default; --include-unavailable shows',
      'them too, within the same listing limit. They remain to-dos.',
      '--channel scopes listing, capture, and open identically: #name matches',
      'only channels; @person matches only one-to-one DMs. Comma-separated',
      'names match exactly those other group participants, in any order.',
      'People match display names, full names, or handles. Bare names search',
      'all conversation types. Matching ignores case and surrounding spaces;',
      '* explicitly allows partial names and multiple conversations. Quote',
      "patterns, e.g. --channel '#atlas-*'. Ambiguous exact names require a",
      'prefix or conversation ID. Raw group-DM slugs also remain supported.',
      'Counts and ambiguity checks cover fetched to-dos (--limit).',
      '',
      '--capture-batch N captures the first N through slack:follow:message: live',
      'threads are captured AND followed for new replies; threads quiet past',
      'the follow expiry window archive without a follow. A thread captured',
      'before gets only its new replies, and an archived one that has come',
      'back to life is followed again. Summary, auto-tags, and auto-rel apply',
      'either way, each to-do is then marked complete in Slack, and captured',
      'files open in the editor when done.',
      '--capture-all captures every available matching to-do in this fetch,',
      'in the selected sort order. Use --limit to increase the fetch size.',
      '',
      'Bare --open on a capture run also opens each to-do the run lands in',
      'Slack — captured threads and already-captured skips alike, since those',
      'are the ones most likely still waiting on a reply. --open=N alone opens',
      'the first N read-only before any capturing: nothing completes, so the',
      'to-dos stay in the To-dos tab.',
    ],
    usage: [
      'sky slack:todos',
      'sky slack:todos --due-within 12h',
      'sky slack:todos --all',
      'sky slack:todos --sort channel',
      'sky slack:todos --channel atlas',
      "sky slack:todos --channel '#atlas-*' --all",
      'sky slack:todos --capture-batch 5',
      'sky slack:todos -n 5 --open',
      'sky slack:todos --open=3',
    ],
    params,
  }

  async run({ args, context, tasks }: CommandArgs<Params>): Promise<CommandResult<PileResult>> {
    return runPile(
      { view: 'todo', command: 'slack:todos', noun: 'To-dos', slackAction: 'Add to-do', defaultSort: 'due' },
      args,
      {
        context,
        tasks,
      },
    )
  }
}
