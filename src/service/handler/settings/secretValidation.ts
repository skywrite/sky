/** Pure field validation shared by the keychain form and its write route. */
export const SECRET_FIELDS = ['category', 'name', 'value', 'user', 'pass'] as const
export type SecretField = (typeof SECRET_FIELDS)[number]

/** A category: letters, digits, dots, dashes, underscores. */
export const SECRET_CATEGORY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
/** A name: the same, plus @ and + — an account email is a name. */
export const SECRET_NAME = /^[A-Za-z0-9][A-Za-z0-9._@+-]{0,127}$/

/** Match the route's normalization; a blank optional name is valid. */
export function secretFieldError(field: SecretField, raw: string): string | null {
  const value = field === 'pass' ? raw : raw.trim()
  switch (field) {
    case 'category':
      return SECRET_CATEGORY.test(value)
        ? null
        : 'Use 1–64 letters, digits, dots, dashes, or underscores. Start with a letter or digit. No spaces.'
    case 'name':
      return !value || SECRET_NAME.test(value)
        ? null
        : 'Use up to 128 letters, digits, dots, dashes, underscores, @, or +. Start with a letter or digit. No spaces.'
    case 'value':
      return value ? null : 'Enter a key or token.'
    case 'user':
      return value ? null : 'Enter a username.'
    case 'pass':
      return value ? null : 'Enter a password.'
  }
}
