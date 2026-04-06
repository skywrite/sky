// Type augmentation for node:util styleText (Node.js 20.12+)
// Deno's built-in node:util types don't include this yet

declare module 'node:util' {
  type ForegroundColor = 'black' | 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'white' | 'gray' | 'grey'

  type BackgroundColor = 'bgBlack' | 'bgRed' | 'bgGreen' | 'bgYellow' | 'bgBlue' | 'bgMagenta' | 'bgCyan' | 'bgWhite'

  type Modifier = 'reset' | 'bold' | 'dim' | 'italic' | 'underline' | 'inverse' | 'hidden' | 'strikethrough'

  type StyleFormat = ForegroundColor | BackgroundColor | Modifier

  export function styleText(format: StyleFormat | StyleFormat[], text: string): string
}
