import { Buffer } from 'node:buffer'
import type { LoginValues } from '#lib/credentials/login.ts'
import type { SensitiveValue } from '#lib/credentials/SensitiveValue.ts'

/** Defense against accidental reflection by a trusted destination, not a sandbox for hostile same-origin code. */
export class LoginRedactor {
  private readonly values = new Set<string>()

  remember(login: LoginValues): void {
    for (const field of [login.username, login.password]) this.rememberValue(field)
  }

  rememberValue(field: SensitiveValue): void {
    field.use((value) => this.rememberText(value))
  }

  rememberText(value: string): void {
    if (!value) return
    this.values.add(value)
    this.values.add(encodeURIComponent(value))
    // HTML forms escape punctuation differently from encodeURIComponent and encode spaces as '+'.
    this.values.add(new URLSearchParams({ value }).toString().slice('value='.length))
    this.values.add(Buffer.from(value).toString('base64'))
    this.values.add(JSON.stringify(value).slice(1, -1))
    this.values.add(
      value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;'),
    )
  }

  get active(): boolean {
    return this.values.size > 0
  }

  contains(text: string): boolean {
    return [...this.values].some((value) => text.includes(value))
  }

  text(text: string): string {
    for (const value of [...this.values].sort((a, b) => b.length - a.length))
      text = text.split(value).join('[redacted]')
    return text
  }
}
