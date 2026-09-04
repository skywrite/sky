import type {
  ConfirmPrompt,
  FormAnswers,
  FormPrompt,
  MultiselectPrompt,
  PlaceAnswer,
  PlacePrompt,
  Prompter,
  SelectPrompt,
  TextPrompt,
} from './Prompter.ts'

/**
 * Nobody is there. Every question answers null, and `interactive` is false
 * so a command can skip the question rather than ask it. This is the server
 * and test default: a headless run never waits on a keystroke that will not
 * come.
 */
export class UnattendedPrompter implements Prompter {
  readonly interactive = false

  text(_prompt: TextPrompt): Promise<string | null> {
    return Promise.resolve(null)
  }

  confirm(_prompt: ConfirmPrompt): Promise<boolean | null> {
    return Promise.resolve(null)
  }

  select(_prompt: SelectPrompt): Promise<string | null> {
    return Promise.resolve(null)
  }

  multiselect(_prompt: MultiselectPrompt): Promise<string[] | null> {
    return Promise.resolve(null)
  }

  place(_prompt: PlacePrompt): Promise<PlaceAnswer | null> {
    return Promise.resolve(null)
  }

  form(_prompt: FormPrompt): Promise<FormAnswers | null> {
    return Promise.resolve(null)
  }
}
