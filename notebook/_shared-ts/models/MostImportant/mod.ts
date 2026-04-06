import YMD from '#universal/dates/ymd.ts'
import { dayWord } from '#universal/dates/mod.ts'
import template from './template.ts'
import { closingQuestions, createPrimaryQuestions, dependQuestions } from './questions.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

export interface MostImportantOptions {
  summary?: string
  count?: number
  dependQuestions?: boolean
}

const defaultOptions: MostImportantOptions = { dependQuestions: false, summary: '' }

export default class MostImportant {
  readonly date: PlainDate
  readonly summary: string
  private _questions: string[] = []

  constructor(date: PlainDate = PlainDate.today(), summary = '') {
    this.date = date
    this.summary = summary
  }

  get YMD(): string {
    return this.date.ymd
  }

  get dayWordShort(): string {
    return dayWord(this.date.toDate(), 'short')
  }

  get [Symbol.toStringTag]() {
    return 'MostImportant'
  }

  toMarkdown(): string {
    return template(this)
  }

  toString(): string {
    return `MostImportant<${this.YMD}>`
  }

  static create(date: PlainDate = PlainDate.today(), opts = defaultOptions): MostImportant {
    const mi = new MostImportant(date, opts.summary)

    const questions: string[] = []

    questions.push(...createPrimaryQuestions(opts.count))
    if (opts.dependQuestions) questions.push(...dependQuestions)
    questions.push(...closingQuestions)

    mi['_questions'] = questions
    return mi
  }
}
