export default function stripPunctuation(input: string): string {
  // replaces numbers .replace(/[^\p{L}\s]/gu,"")
  return input.replace(/[|\.,-\/#!$%\^&\*;:{}=\-_`~()@\+\?><\[\]\+]/g, '').replace(/\s{2,}/g, ' ')
}
