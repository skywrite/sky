import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Text, useApp, useInput, useStdout } from 'ink'
import type { DOMElement } from 'ink'
import type { ChatInputPromptProps } from './types.ts'

const MAX_PREVIEW_TURNS = 10
const MAX_CONTEXT_ROWS = 22
const CONTEXT_SCROLL_PAGE_SIZE = 10
const COLLAPSED_ICON = '▸'
const EXPANDED_ICON = '▾'
const CURSOR_BLOCK = '█'
// Bracketed paste markers: \x1b[200~ (start) and \x1b[201~ (end).
// Ink's key parser strips the leading \x1b, so we also strip bare [200~ / [201~.
const PASTE_MARKERS = ['\x1b[200~', '\x1b[201~', '[200~', '[201~']

interface ContextTreeNode {
  name: string
  path: string
  directories: Map<string, ContextTreeNode>
  files: Set<string>
}

interface ContextTreeRow {
  key: string
  line: string
  kind: 'directory' | 'file'
  path: string
  parentPath: string | null
  depth: number
  hasChildren: boolean
  isExpanded: boolean
}

interface MouseReport {
  x: number
  y: number
  button: number
  isRelease: boolean
  isMotion: boolean
  isWheel: boolean
}

interface ElementLayout {
  left: number
  top: number
  width: number
  height: number
}

interface CursorPositionReport {
  row: number
}

function finalizeInput(raw: string): string {
  return raw.replace(/\n+$/g, '').trim()
}

function isPastedInput(input: string): boolean {
  return input.length > 1 && (input.includes('\n') || input.includes('\r'))
}

function cleanPastedText(input: string): string {
  let text = input
  for (const marker of PASTE_MARKERS) {
    text = text.replaceAll(marker, '')
  }
  return text
    .replace(/\r\n/g, '\n') // normalize CRLF
    .replace(/\r/g, '\n') // normalize CR
    .replace(/\n+$/, '') // trim trailing newlines
}

function formatPasteLabel(text: string, index: number, summary?: string | null): string {
  const lines = text.split('\n')
  const chars = text.length
  const summaryPart = summary ? ` — ${summary}` : ''
  return `[Paste ${index + 1}: ${lines.length} line${lines.length === 1 ? '' : 's'}, ${chars} chars${summaryPart}]`
}

// Marker format: \x00PASTE_N\x00 where N is the paste block index
// deno-lint-ignore no-control-regex
const PASTE_MARKER_RE = /\x00PASTE_(\d+)\x00/g
// deno-lint-ignore no-control-regex
const PASTE_MARKER_SINGLE_RE = /^\x00PASTE_(\d+)\x00$/

function toConversationPreview(content: string, maxLength = 90): string {
  const line =
    content
      .replace(/<!--[\s\S]*?-->/g, '')
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? ''

  if (line.length <= maxLength) return line
  return line.slice(0, maxLength - 3) + '...'
}

function truncateMiddle(text: string, maxLength: number): string {
  if (maxLength <= 0) return ''
  if (text.length <= maxLength) return text
  if (maxLength <= 3) return text.slice(0, maxLength)

  const available = maxLength - 3
  const left = Math.ceil(available / 2)
  const right = Math.floor(available / 2)
  return `${text.slice(0, left)}...${text.slice(-right)}`
}

function truncateEnd(text: string, maxLength: number): string {
  if (maxLength <= 0) return ''
  if (text.length <= maxLength) return text
  if (maxLength <= 3) return text.slice(0, maxLength)
  return text.slice(0, maxLength - 3) + '...'
}

function getTerminalWidth(stdout: { columns?: number } | undefined): number {
  if (stdout?.columns && stdout.columns > 0) return stdout.columns
  return 120
}

function createContextTreeNode(name: string, path: string): ContextTreeNode {
  return {
    name,
    path,
    directories: new Map<string, ContextTreeNode>(),
    files: new Set<string>(),
  }
}

function normalizeContextPath(path: string): string {
  return path
    .replaceAll('\\', '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
}

function sortByName(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base' })
}

function appendContextTreeRows(
  node: ContextTreeNode,
  depth: number,
  rows: ContextTreeRow[],
  expandedDirectories: ReadonlySet<string>,
) {
  const indent = '  '.repeat(depth)
  const sortedDirectories = Array.from(node.directories.values()).sort((a, b) => sortByName(a.name, b.name))
  const sortedFiles = Array.from(node.files.values()).sort(sortByName)

  for (const directory of sortedDirectories) {
    const hasChildren = directory.directories.size > 0 || directory.files.size > 0
    const isExpanded = hasChildren && expandedDirectories.has(directory.path)
    rows.push({
      key: `dir:${directory.path}`,
      line: `${indent}${isExpanded ? EXPANDED_ICON : COLLAPSED_ICON} ${directory.name}/`,
      kind: 'directory',
      path: directory.path,
      parentPath: node.path || null,
      depth,
      hasChildren,
      isExpanded,
    })

    if (isExpanded) {
      appendContextTreeRows(directory, depth + 1, rows, expandedDirectories)
    }
  }

  for (const filePath of sortedFiles) {
    const fileName = filePath.split('/').pop() ?? filePath
    rows.push({
      key: `file:${filePath}`,
      line: `${indent}  ${fileName}`,
      kind: 'file',
      path: filePath,
      parentPath: node.path || null,
      depth,
      hasChildren: false,
      isExpanded: false,
    })
  }
}

function buildContextTreeRows(contextFiles: string[], expandedDirectories: ReadonlySet<string>): ContextTreeRow[] {
  const root = createContextTreeNode('', '')

  for (const contextFile of contextFiles) {
    const normalized = normalizeContextPath(contextFile.trim())
    if (!normalized) continue

    const segments = normalized.split('/').filter((segment) => segment.length > 0)
    if (segments.length === 0) continue

    let current = root
    let currentPath = ''
    for (const segment of segments.slice(0, -1)) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment
      let nextNode = current.directories.get(segment)
      if (!nextNode) {
        nextNode = createContextTreeNode(segment, currentPath)
        current.directories.set(segment, nextNode)
      }
      current = nextNode
    }

    const fileName = segments[segments.length - 1]!
    const filePath = currentPath ? `${currentPath}/${fileName}` : fileName
    current.files.add(filePath)
  }

  const rows: ContextTreeRow[] = []
  appendContextTreeRows(root, 0, rows, expandedDirectories)
  return rows
}

function parseMouseReports(input: string): MouseReport[] {
  const matches = input.matchAll(/\[<(\d+);(\d+);(\d+)([mM])/g)
  const reports: MouseReport[] = []

  for (const match of matches) {
    const code = Number(match[1])
    const x = Number(match[2])
    const y = Number(match[3])
    if (!Number.isFinite(code) || !Number.isFinite(x) || !Number.isFinite(y)) {
      continue
    }

    reports.push({
      x,
      y,
      button: code & 0b11,
      isRelease: match[4] === 'm',
      isMotion: (code & 0b10_0000) !== 0,
      isWheel: (code & 0b100_0000) !== 0,
    })
  }

  return reports
}

function parseCursorPositionReport(input: string): CursorPositionReport | null {
  const matches = input.matchAll(/\[\??(\d+);(\d+)R/g)
  let row: number | null = null

  for (const match of matches) {
    const nextRow = Number(match[1])
    const column = Number(match[2])
    if (!Number.isFinite(nextRow) || !Number.isFinite(column)) continue
    row = nextRow
  }

  return row === null ? null : { row }
}

function computeRenderTopRow(rootNode: DOMElement | null, rowBelowOutput: number): number {
  const rootHeight = Math.max(1, Math.round(rootNode?.yogaNode?.getComputedHeight() ?? 1))
  return Math.max(1, rowBelowOutput - rootHeight)
}

function getAbsoluteLayout(node: DOMElement | null, renderTopRow: number): ElementLayout | null {
  if (!node?.yogaNode) return null

  let left = 0
  let top = 0
  let current: DOMElement | undefined = node
  while (current) {
    if (current.yogaNode) {
      left += Math.round(current.yogaNode.getComputedLeft())
      top += Math.round(current.yogaNode.getComputedTop())
    }
    current = current.parentNode
  }

  return {
    left: left + 1,
    top: top + renderTopRow,
    width: Math.round(node.yogaNode.getComputedWidth()),
    height: Math.max(1, Math.round(node.yogaNode.getComputedHeight())),
  }
}

export function ChatInputPrompt({
  placeholder,
  hint,
  saveOnExit,
  logToDay,
  splitViewEnabled,
  contextScrollOffset,
  conversation,
  contextFiles,
  summarizePaste,
  onDone,
}: ChatInputPromptProps) {
  const { exit } = useApp()
  const { stdout } = useStdout()
  const [buffer, setBuffer] = useState('')
  const [pasteBlocks, setPasteBlocks] = useState<string[]>([])
  const [pasteSummaries, setPasteSummaries] = useState<(string | null)[]>([])
  const [saveMode, setSaveMode] = useState(saveOnExit)
  const [logMode, setLogMode] = useState(logToDay)
  const [splitView, setSplitView] = useState(splitViewEnabled)
  const [terminalWidth, setTerminalWidth] = useState(() => getTerminalWidth(stdout))
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(() => new Set())
  const contextRows = useMemo(
    () => buildContextTreeRows(contextFiles, expandedDirectories),
    [contextFiles, expandedDirectories],
  )
  const totalContextRows = contextRows.length
  const directoryIndexByPath = useMemo(() => {
    const indexByPath = new Map<string, number>()
    for (const [index, row] of contextRows.entries()) {
      if (row.kind === 'directory') {
        indexByPath.set(row.path, index)
      }
    }
    return indexByPath
  }, [contextRows])
  const contextRowIndexByKey = useMemo(() => {
    const indexByKey = new Map<string, number>()
    for (const [index, row] of contextRows.entries()) {
      indexByKey.set(row.key, index)
    }
    return indexByKey
  }, [contextRows])
  const [contextOffset, setContextOffset] = useState(() => clampContextOffset(contextScrollOffset, totalContextRows))
  const [selectedContextIndex, setSelectedContextIndex] = useState(() =>
    clampContextSelection(contextScrollOffset, totalContextRows),
  )
  const doneRef = useRef(false)
  const pasteBlocksRef = useRef<string[]>([])
  const pasteSummariesRef = useRef<(string | null)[]>([])
  const pasteTimestampRef = useRef(0)
  const emptyLineStreak = useRef(0)
  const saveModeRef = useRef(saveOnExit)
  const logModeRef = useRef(logToDay)
  const splitViewRef = useRef(splitViewEnabled)
  const contextOffsetRef = useRef(clampContextOffset(contextScrollOffset, totalContextRows))
  const selectedContextIndexRef = useRef(clampContextSelection(contextScrollOffset, totalContextRows))
  const contextRowRefs = useRef<Map<string, DOMElement>>(new Map())
  const rootContainerRef = useRef<DOMElement | null>(null)
  const cursorRowRef = useRef<number | null>(null)
  const renderTopRowRef = useRef<number | null>(null)
  const hasFallbackCalibrationRef = useRef(false)

  const setModes = ({ save, log }: { save: boolean; log: boolean }) => {
    saveModeRef.current = save
    logModeRef.current = log
    setSaveMode(save)
    setLogMode(log)
  }

  const finish = (value: string | null) => {
    if (doneRef.current) return
    doneRef.current = true
    // Expand inline paste placeholders with actual content
    const blocks = pasteBlocksRef.current
    const expanded =
      value?.replace(PASTE_MARKER_RE, (_, idxStr) => {
        return blocks[Number(idxStr)] ?? ''
      }) ?? null
    onDone({
      message: expanded,
      saveOnExit: saveModeRef.current,
      logToDay: logModeRef.current,
      splitViewEnabled: splitViewRef.current,
      contextScrollOffset: contextOffsetRef.current,
    })
    exit()
  }

  const setSelectedContextIndexValue = (next: number) => {
    const clampedSelection = clampContextSelection(next, totalContextRows)
    if (clampedSelection !== selectedContextIndexRef.current) {
      selectedContextIndexRef.current = clampedSelection
      setSelectedContextIndex(clampedSelection)
    }

    const alignedOffset = alignContextOffsetToSelection(contextOffsetRef.current, clampedSelection, totalContextRows)
    if (alignedOffset !== contextOffsetRef.current) {
      contextOffsetRef.current = alignedOffset
      setContextOffset(alignedOffset)
    }
  }

  const expandDirectory = (path: string) => {
    setExpandedDirectories((prev) => {
      if (prev.has(path)) return prev
      const next = new Set(prev)
      next.add(path)
      return next
    })
  }

  const collapseDirectory = (path: string) => {
    setExpandedDirectories((prev) => {
      if (!prev.has(path)) return prev
      const next = new Set(prev)
      next.delete(path)
      return next
    })
  }

  const setContextRowRef = (rowKey: string, node: DOMElement | null) => {
    if (node) {
      contextRowRefs.current.set(rowKey, node)
      return
    }
    contextRowRefs.current.delete(rowKey)
  }

  const handleMouseClickOnContextTree = (column: number, row: number) => {
    const renderTopRow = renderTopRowRef.current ?? 1

    for (const [rowKey, element] of contextRowRefs.current.entries()) {
      const rowIndex = contextRowIndexByKey.get(rowKey)
      if (typeof rowIndex !== 'number') continue

      const layout = getAbsoluteLayout(element, renderTopRow)
      if (!layout) continue
      if (row < layout.top || row >= layout.top + layout.height) continue

      setSelectedContextIndexValue(rowIndex)
      const contextRow = contextRows[rowIndex]
      if (contextRow?.kind !== 'directory') return

      const triangleColumn = layout.left + contextRow.depth * 2
      if (column !== triangleColumn) return

      if (contextRow.isExpanded) {
        collapseDirectory(contextRow.path)
      } else if (contextRow.hasChildren) {
        expandDirectory(contextRow.path)
      }
      return
    }
  }

  useEffect(() => {
    setTerminalWidth(getTerminalWidth(stdout))

    const onResize = () => setTerminalWidth(getTerminalWidth(stdout))
    stdout?.on?.('resize', onResize)
    return () => {
      stdout?.off?.('resize', onResize)
    }
  }, [stdout])

  useEffect(() => {
    if (!splitView) return
    stdout?.write?.('\u001b[?1000h\u001b[?1006h')
    return () => {
      stdout?.write?.('\u001b[?1000l\u001b[?1006l')
    }
  }, [splitView, stdout])

  useEffect(() => {
    if (splitView) return
    cursorRowRef.current = null
    renderTopRowRef.current = null
    hasFallbackCalibrationRef.current = false
  }, [splitView])

  useEffect(() => {
    if (!splitView) return
    if (hasFallbackCalibrationRef.current) return

    const fallbackTerminalRows = stdout?.rows && stdout.rows > 0 ? stdout.rows : 24
    renderTopRowRef.current = computeRenderTopRow(rootContainerRef.current, fallbackTerminalRows)
    hasFallbackCalibrationRef.current = true
  }, [splitView, stdout])

  useEffect(() => {
    if (!splitView) return
    stdout?.write?.('\u001b[6n')
  }, [splitView, stdout, terminalWidth, totalContextRows])

  useEffect(() => {
    const clampedSelection = clampContextSelection(selectedContextIndexRef.current, totalContextRows)
    if (clampedSelection !== selectedContextIndexRef.current) {
      selectedContextIndexRef.current = clampedSelection
      setSelectedContextIndex(clampedSelection)
    }

    const alignedOffset = alignContextOffsetToSelection(contextOffsetRef.current, clampedSelection, totalContextRows)
    if (alignedOffset !== contextOffsetRef.current) {
      contextOffsetRef.current = alignedOffset
      setContextOffset(alignedOffset)
    }
  }, [totalContextRows])

  const append = (value: string) => {
    if (!value) return
    emptyLineStreak.current = 0
    setBuffer((prev) => prev + value)
  }

  const handleEnter = () => {
    setBuffer((prev) => {
      const currentLine = prev.slice(prev.lastIndexOf('\n') + 1)
      if (currentLine.trim() === '') {
        emptyLineStreak.current += 1
        if (emptyLineStreak.current >= 2) {
          queueMicrotask(() => {
            const message = finalizeInput(prev)
            finish(message.length > 0 ? message : null)
          })
          return prev
        }
      } else {
        emptyLineStreak.current = 0
      }
      return prev + '\n'
    })
  }

  useInput((input, _key) => {
    // Detect paste: multi-character input containing newlines.
    // Ink's key parser garbles pasted text by interpreting escape sequences
    // as arrow keys, function keys, etc. Capture the whole paste as-is.
    //
    // Large pastes may arrive in multiple chunks from the terminal. Chunks
    // without newlines would bypass isPastedInput and leak into the buffer.
    // Use a short cooldown window to capture trailing paste chunks.
    const PASTE_COOLDOWN_MS = 100
    const isPasteCooldown = pasteTimestampRef.current > 0 && Date.now() - pasteTimestampRef.current < PASTE_COOLDOWN_MS

    if (isPastedInput(input) || (isPasteCooldown && input.length > 1)) {
      const cleaned = cleanPastedText(input)
      if (cleaned.length > 0) {
        if (isPasteCooldown && pasteBlocksRef.current.length > 0) {
          // Trailing chunk of the same paste — append to last block
          const lastIdx = pasteBlocksRef.current.length - 1
          pasteBlocksRef.current[lastIdx] += '\n' + cleaned
        } else {
          // New paste block — insert placeholder marker into buffer
          const idx = pasteBlocksRef.current.length
          pasteBlocksRef.current.push(cleaned)
          pasteSummariesRef.current.push(null)
          setBuffer((prev) => prev + `\x00PASTE_${idx}\x00`)
          // Fire off async summary generation
          if (summarizePaste) {
            summarizePaste(cleaned)
              .then((summary) => {
                if (doneRef.current) return
                pasteSummariesRef.current[idx] = summary
                setPasteSummaries([...pasteSummariesRef.current])
              })
              .catch(() => {})
          }
        }
        setPasteBlocks([...pasteBlocksRef.current])
        emptyLineStreak.current = 0
      }
      pasteTimestampRef.current = Date.now()
      return
    }

    const key = _key
    const cursorPosition = parseCursorPositionReport(input)
    if (cursorPosition) {
      cursorRowRef.current = cursorPosition.row
      renderTopRowRef.current = computeRenderTopRow(rootContainerRef.current, cursorPosition.row)
    }

    const mouseReports = parseMouseReports(input)
    if (mouseReports.length > 0) {
      for (const mouseReport of mouseReports) {
        if (
          splitViewRef.current &&
          !mouseReport.isRelease &&
          !mouseReport.isMotion &&
          !mouseReport.isWheel &&
          mouseReport.button === 0
        ) {
          handleMouseClickOnContextTree(mouseReport.x, mouseReport.y)
        }
      }
      return
    }

    const isHomeKey = input === '\u001b[H' || input === '\u001b[1~'
    const isEndKey = input === '\u001b[F' || input === '\u001b[4~'

    if (key.ctrl && input === 'c') {
      finish(null)
      return
    }
    if (key.ctrl && input === 's') {
      const nextSave = !saveModeRef.current
      const nextLog = nextSave ? logModeRef.current : false
      setModes({ save: nextSave, log: nextLog })
      return
    }
    if (key.ctrl && input === 'l') {
      const nextLog = !logModeRef.current
      const nextSave = nextLog ? true : saveModeRef.current
      setModes({ save: nextSave, log: nextLog })
      return
    }
    if (key.ctrl && input === 'b') {
      const nextSplitView = !splitViewRef.current
      splitViewRef.current = nextSplitView
      setSplitView(nextSplitView)
      return
    }
    if (splitViewRef.current && key.upArrow) {
      setSelectedContextIndexValue(selectedContextIndexRef.current - 1)
      return
    }
    if (splitViewRef.current && key.downArrow) {
      setSelectedContextIndexValue(selectedContextIndexRef.current + 1)
      return
    }
    if (splitViewRef.current && key.pageUp) {
      setSelectedContextIndexValue(selectedContextIndexRef.current - CONTEXT_SCROLL_PAGE_SIZE)
      return
    }
    if (splitViewRef.current && key.pageDown) {
      setSelectedContextIndexValue(selectedContextIndexRef.current + CONTEXT_SCROLL_PAGE_SIZE)
      return
    }
    if (splitViewRef.current && isHomeKey) {
      setSelectedContextIndexValue(0)
      return
    }
    if (splitViewRef.current && isEndKey) {
      setSelectedContextIndexValue(Number.MAX_SAFE_INTEGER)
      return
    }
    if (splitViewRef.current && key.rightArrow) {
      const selectedRow = contextRows[selectedContextIndexRef.current]
      if (selectedRow?.kind === 'directory') {
        if (selectedRow.hasChildren && !selectedRow.isExpanded) {
          expandDirectory(selectedRow.path)
          return
        }

        const childRow = contextRows[selectedContextIndexRef.current + 1]
        if (childRow && childRow.depth > selectedRow.depth) {
          setSelectedContextIndexValue(selectedContextIndexRef.current + 1)
          return
        }
      }
      return
    }
    if (splitViewRef.current && key.leftArrow) {
      const selectedRow = contextRows[selectedContextIndexRef.current]
      if (!selectedRow) return

      if (selectedRow.kind === 'directory' && selectedRow.isExpanded) {
        collapseDirectory(selectedRow.path)
        return
      }

      if (selectedRow.parentPath) {
        const parentIndex = directoryIndexByPath.get(selectedRow.parentPath)
        if (typeof parentIndex === 'number') {
          setSelectedContextIndexValue(parentIndex)
          return
        }
      }
      return
    }
    if (key.return) {
      handleEnter()
      return
    }
    if (key.backspace || key.delete) {
      emptyLineStreak.current = 0
      setBuffer((prev) => {
        if (prev.length === 0) return ''
        // If backspacing into a paste placeholder (\x00PASTE_N\x00), delete the whole marker
        if (prev[prev.length - 1] === '\x00') {
          const markerStart = prev.lastIndexOf('\x00', prev.length - 2)
          if (markerStart >= 0) {
            const marker = prev.slice(markerStart)
            const match = marker.match(PASTE_MARKER_SINGLE_RE)
            if (match) {
              const idx = Number(match[1])
              pasteBlocksRef.current[idx] = ''
              setPasteBlocks([...pasteBlocksRef.current])
              return prev.slice(0, markerStart)
            }
          }
        }
        return prev.slice(0, -1)
      })
      return
    }
    if (key.tab) {
      append('  ')
      return
    }
    if (input) append(input)
  })

  const showPlaceholder = buffer.length === 0

  // Build buffer display elements with inline paste labels
  const bufferElements = useMemo(() => {
    const elements: React.ReactElement[] = []
    const re = new RegExp(PASTE_MARKER_RE.source, 'g')
    let lastIndex = 0
    let match
    let segKey = 0
    while ((match = re.exec(buffer)) !== null) {
      if (match.index > lastIndex) {
        elements.push(React.createElement(Text, { key: `t${segKey++}` }, buffer.slice(lastIndex, match.index)))
      }
      const idx = Number(match[1])
      const block = pasteBlocks[idx]
      if (block) {
        elements.push(
          React.createElement(
            Text,
            { key: `p${segKey++}`, color: 'yellow' },
            formatPasteLabel(block, idx, pasteSummaries[idx]),
          ),
        )
      }
      lastIndex = match.index + match[0].length
    }
    if (lastIndex < buffer.length) {
      elements.push(React.createElement(Text, { key: `t${segKey++}` }, buffer.slice(lastIndex)))
    }
    return elements
  }, [buffer, pasteBlocks, pasteSummaries])

  const previewTurns = conversation.slice(-MAX_PREVIEW_TURNS)
  const previewRows = contextRows.slice(contextOffset, contextOffset + MAX_CONTEXT_ROWS)
  const visibleStart = totalContextRows > 0 ? contextOffset + 1 : 0
  const visibleEnd = Math.min(contextOffset + previewRows.length, totalContextRows)
  const splitPaneWidth = Math.max(8, Math.floor((terminalWidth - 3) / 2))
  const paneTextWidth = Math.max(8, splitPaneWidth - 4)
  const conversationPreviewWidth = Math.max(12, paneTextWidth - 6)
  const contextFileWidth = Math.max(8, paneTextWidth - 2)
  const footerText = truncateEnd(
    `Rows ${visibleStart}-${visibleEnd}/${totalContextRows} (files ${contextFiles.length}) Arrows move, <- -> collapse/expand`,
    paneTextWidth,
  )

  return React.createElement(
    Box,
    { flexDirection: 'column', ref: rootContainerRef },
    React.createElement(
      Box,
      { flexDirection: 'row' },
      React.createElement(Text, { color: 'gray' }, 'Modes: '),
      React.createElement(Text, { color: saveMode ? 'green' : 'red' }, saveMode ? '[SAVE ON]' : '[SAVE OFF]'),
      React.createElement(Text, null, ' '),
      React.createElement(Text, { color: logMode ? 'green' : 'gray' }, logMode ? '[LOG ON]' : '[LOG OFF]'),
      React.createElement(Text, null, ' '),
      React.createElement(
        Text,
        { color: splitView ? 'green' : 'gray' },
        splitView ? '[CTX SPLIT ON]' : '[CTX SPLIT OFF]',
      ),
    ),
    splitView
      ? React.createElement(
          Box,
          { flexDirection: 'row', marginTop: 1, marginBottom: 1 },
          React.createElement(
            Box,
            {
              flexDirection: 'column',
              borderStyle: 'round',
              paddingX: 1,
              marginRight: 1,
              flexGrow: 1,
              flexShrink: 1,
              flexBasis: 0,
              minWidth: 0,
            },
            React.createElement(Text, { color: 'cyan' }, 'Conversation'),
            previewTurns.length > 0
              ? previewTurns.map((turn, idx) =>
                  React.createElement(
                    Text,
                    {
                      key: `turn-${idx}`,
                      color: turn.role === 'user' ? 'yellow' : 'white',
                    },
                    `${turn.role === 'user' ? 'You' : 'AI'}: ${toConversationPreview(
                      turn.content,
                      conversationPreviewWidth,
                    )}`,
                  ),
                )
              : React.createElement(Text, { color: 'gray' }, '(No conversation yet)'),
          ),
          React.createElement(
            Box,
            {
              flexDirection: 'column',
              borderStyle: 'round',
              paddingX: 1,
              flexGrow: 1,
              flexShrink: 1,
              flexBasis: 0,
              minWidth: 0,
            },
            React.createElement(Text, { color: 'green' }, `Context Files (${contextFiles.length})`),
            previewRows.length > 0
              ? previewRows.map((row, idx) =>
                  React.createElement(
                    Box,
                    {
                      key: row.key,
                      ref: (node: DOMElement | null) => setContextRowRef(row.key, node),
                      flexDirection: 'row',
                      minWidth: 0,
                    },
                    React.createElement(
                      Text,
                      {
                        color: row.kind === 'directory' ? 'cyan' : 'white',
                        inverse: contextOffset + idx === selectedContextIndex,
                      },
                      truncateMiddle(row.line, contextFileWidth),
                    ),
                  ),
                )
              : React.createElement(Text, { color: 'gray' }, '(No context loaded yet)'),
            totalContextRows > 0 ? React.createElement(Text, { color: 'gray' }, footerText) : null,
          ),
        )
      : null,
    React.createElement(Text, { color: 'cyan' }, 'You'),
    React.createElement(
      Box,
      { borderStyle: 'round', paddingX: 1, flexDirection: 'column' },
      showPlaceholder
        ? React.createElement(
            Text,
            { wrap: 'truncate-end' },
            React.createElement(Text, { color: 'cyan' }, CURSOR_BLOCK),
            React.createElement(Text, { color: 'gray' }, ` ${placeholder}`),
          )
        : React.createElement(
            Text,
            null,
            ...bufferElements,
            React.createElement(Text, { color: 'cyan' }, CURSOR_BLOCK),
          ),
    ),
    React.createElement(Text, { color: 'gray', wrap: 'truncate-end' }, hint),
  )
}

function clampContextOffset(offset: number, totalRows: number): number {
  const maxOffset = Math.max(0, totalRows - MAX_CONTEXT_ROWS)
  if (!Number.isFinite(offset)) return maxOffset
  if (offset < 0) return 0
  if (offset > maxOffset) return maxOffset
  return offset
}

function clampContextSelection(selection: number, totalRows: number): number {
  if (totalRows <= 0) return 0
  const maxSelection = totalRows - 1
  if (!Number.isFinite(selection)) return maxSelection
  if (selection < 0) return 0
  if (selection > maxSelection) return maxSelection
  return selection
}

function alignContextOffsetToSelection(offset: number, selection: number, totalRows: number): number {
  if (totalRows <= 0) return 0

  const clampedSelection = clampContextSelection(selection, totalRows)
  let nextOffset = clampContextOffset(offset, totalRows)
  if (clampedSelection < nextOffset) {
    nextOffset = clampedSelection
  }

  const lastVisibleRow = nextOffset + MAX_CONTEXT_ROWS - 1
  if (clampedSelection > lastVisibleRow) {
    nextOffset = clampedSelection - MAX_CONTEXT_ROWS + 1
  }

  return clampContextOffset(nextOffset, totalRows)
}
