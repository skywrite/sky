export default function parseArgName(input: string): string {
  const match = input.match(/\<(?<arg>.+)\>/)

  if (!match?.groups?.arg) throw new Error(`parseFlagName(): parse error on ${input}.`)

  return match.groups.arg
}
