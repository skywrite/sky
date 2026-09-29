import { inspect } from 'node:util'

/** Values are released only at an explicit use site, never by JSON or log inspection. */
export class SensitiveValue {
  #value: string

  constructor(value: string) {
    this.#value = value
  }

  use<T>(consume: (value: string) => T): T {
    return consume(this.#value)
  }

  toJSON(): string {
    return '[redacted]'
  }

  toString(): string {
    return '[redacted]'
  }

  [inspect.custom](): string {
    return '[redacted]'
  }
}
