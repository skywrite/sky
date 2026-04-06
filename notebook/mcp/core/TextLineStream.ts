/**
 * Cross-runtime TransformStream that splits text input by newlines.
 * Buffers partial lines across chunks and flushes any remaining content on close.
 */
export class TextLineStream extends TransformStream<string, string> {
  constructor() {
    let buffer = ''

    super({
      transform(chunk, controller) {
        buffer += chunk
        const lines = buffer.split('\n')
        // Last element is either empty (if chunk ended with \n) or a partial line
        buffer = lines.pop()!
        for (const line of lines) {
          controller.enqueue(line)
        }
      },
      flush(controller) {
        if (buffer) {
          controller.enqueue(buffer)
        }
      },
    })
  }
}
