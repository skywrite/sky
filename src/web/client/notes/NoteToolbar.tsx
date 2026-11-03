/**
 * The note's formatting row: the line's style by name, then marks, lists, blocks and files, each
 * button doing what its key does in the editor. Undo and Redo keep the far end.
 */

import { ActionIcon, Menu, Tooltip } from '@mantine/core'
import { type MouseEvent, type RefObject, useEffect, useRef, useState } from 'react'
import { type Bookmark, bookmarkFromSelection } from '../editor/wysiwyg/bookmark.ts'
import type { EditorFormat, EditorHandle } from '../editor/wysiwyg/mod.ts'
import { FormatIcon, type FormatIconName } from './FormatIcon.tsx'

interface Tool {
  command: EditorFormat
  icon: FormatIconName
  label: string
  keys?: string
}

const STYLES: Array<{ command: EditorFormat; label: string; keys: string }> = [
  { command: 'paragraph', label: 'Text', keys: '⌘0' },
  { command: 'heading1', label: 'Heading 1', keys: '⌘1' },
  { command: 'heading2', label: 'Heading 2', keys: '⌘2' },
  { command: 'heading3', label: 'Heading 3', keys: '⌘3' },
]

const GROUPS: Tool[][] = [
  [
    { command: 'bold', icon: 'bold', label: 'Bold', keys: '⌘B' },
    { command: 'italic', icon: 'italic', label: 'Italic', keys: '⌘I' },
    { command: 'strike', icon: 'strike', label: 'Strikethrough', keys: '⇧⌘X' },
    { command: 'code', icon: 'code', label: 'Code', keys: '⌘E' },
    { command: 'link', icon: 'link', label: 'Link', keys: '⌘K' },
  ],
  [
    { command: 'bullets', icon: 'bullets', label: 'Bulleted list', keys: '⇧⌘8' },
    { command: 'numbers', icon: 'numbers', label: 'Numbered list', keys: '⇧⌘7' },
    { command: 'tasks', icon: 'tasks', label: 'Checklist', keys: '⇧⌘9' },
  ],
  [
    { command: 'quote', icon: 'quote', label: 'Quote', keys: '⇧⌘Q' },
    { command: 'codeblock', icon: 'codeblock', label: 'Code block' },
    { command: 'table', icon: 'table', label: 'Table' },
    { command: 'divider', icon: 'divider', label: 'Divider' },
  ],
]

/** The style a line has, by the element the editor drew it as. */
function styleOf(leaf: HTMLElement | null): string {
  const tag = leaf?.tagName
  if (tag === 'H1') return 'Heading 1'
  if (tag === 'H2') return 'Heading 2'
  if (tag === 'H3') return 'Heading 3'
  if (tag === 'H4' || tag === 'H5' || tag === 'H6') return 'Heading'
  return 'Text'
}

/** The button keeps the editor's caret: a press that took focus would move it. */
function keepCaret(event: MouseEvent) {
  event.preventDefault()
}

function ToolButton({ tool, onRun }: { tool: Tool; onRun: (command: EditorFormat) => void }) {
  return (
    <Tooltip label={tool.keys ? `${tool.label} ${tool.keys}` : tool.label} openDelay={350} withinPortal>
      <ActionIcon size="md" aria-label={tool.label} onMouseDown={keepCaret} onClick={() => onRun(tool.command)}>
        <FormatIcon name={tool.icon} />
      </ActionIcon>
    </Tooltip>
  )
}

export function NoteToolbar({
  editor,
  root,
  onImage,
}: {
  editor: RefObject<EditorHandle | null>
  root: RefObject<HTMLElement | null>
  /** Picks files to add beside the note */
  onImage: () => void
}) {
  const [style, setStyle] = useState('Text')
  // The caret the style menu opened from; the menu takes focus, so the caret is put back before a change.
  const held = useRef<Bookmark | null>(null)
  useEffect(() => {
    const update = () => {
      const element = root.current
      const anchor = document.getSelection()?.anchorNode
      if (!element || !anchor || !element.contains(anchor)) return
      const leaf = (anchor instanceof Element ? anchor : anchor.parentElement)?.closest<HTMLElement>('[data-node]')
      setStyle(styleOf(leaf ?? null))
    }
    document.addEventListener('selectionchange', update)
    return () => document.removeEventListener('selectionchange', update)
  }, [root])
  const run = (command: EditorFormat) => editor.current?.format(command)
  const restyle = (command: EditorFormat) => {
    const caret = held.current
    if (caret) editor.current?.selectText({ blockId: caret.blockId, start: caret.start, end: caret.end })
    run(command)
  }

  return (
    <div className="sky-note-tools" role="toolbar" aria-label="Formatting">
      <Menu position="bottom-start" shadow="md" width={210}>
        <Menu.Target>
          <button
            type="button"
            className="sky-note-style"
            aria-label={`Text style: ${style}`}
            onMouseDown={(event) => {
              held.current = root.current ? bookmarkFromSelection(root.current) : null
              keepCaret(event)
            }}
          >
            <span>{style}</span>
            <FormatIcon name="chevron" size={14} />
          </button>
        </Menu.Target>
        <Menu.Dropdown>
          {STYLES.map((option) => (
            <Menu.Item
              key={option.command}
              onClick={() => restyle(option.command)}
              rightSection={<kbd className="sky-menu-kbd">{option.keys}</kbd>}
            >
              {option.label}
            </Menu.Item>
          ))}
        </Menu.Dropdown>
      </Menu>
      {GROUPS.map((group) => (
        <div className="sky-note-tool-group" key={group[0]!.command}>
          {group.map((tool) => (
            <ToolButton key={tool.command} tool={tool} onRun={run} />
          ))}
        </div>
      ))}
      <div className="sky-note-tool-group">
        <Tooltip label="Image or file" openDelay={350} withinPortal>
          <ActionIcon size="md" aria-label="Image or file" onMouseDown={keepCaret} onClick={onImage}>
            <FormatIcon name="image" />
          </ActionIcon>
        </Tooltip>
      </div>
      <div className="sky-note-tool-group sky-note-tool-end">
        <ToolButton tool={{ command: 'undo', icon: 'undo', label: 'Undo', keys: '⌘Z' }} onRun={run} />
        <ToolButton tool={{ command: 'redo', icon: 'redo', label: 'Redo', keys: '⇧⌘Z' }} onRun={run} />
      </div>
    </div>
  )
}
