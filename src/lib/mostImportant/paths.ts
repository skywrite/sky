/** Daily MI ordinals are canonical; also read files created by the timestamp-based writer. */
export const MI_FILE = /^(?:MI\d+(?:[_-].*)?|\d{4}-\d{2}-\d{2}_\d{6}_.+)\.md$/i
