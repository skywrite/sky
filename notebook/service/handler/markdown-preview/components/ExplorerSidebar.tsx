import React from 'react'
import { buildMarkdownPreviewPath } from '../request.ts'
import type { MarkdownExplorerDirectory, MarkdownPreviewMode, MarkdownPreviewTheme } from '../types.ts'

interface ExplorerSidebarProps {
  explorerRoots: MarkdownExplorerDirectory[]
  mode: MarkdownPreviewMode
  theme: MarkdownPreviewTheme
}

export function ExplorerSidebar(props: ExplorerSidebarProps) {
  const { explorerRoots, mode, theme } = props

  return (
    <aside className="explorer-shell">
      <div>
        <h2 className="explorer-title">Explorer</h2>
        <p className="explorer-copy">Browse notebook markdown files and jump between them.</p>
        {explorerRoots.length > 0 ? (
          <div className="explorer-tree">
            {explorerRoots.map((node) => (
              <React.Fragment key={node.relativePath}>
                <ExplorerDirectoryNode node={node} mode={mode} theme={theme} />
              </React.Fragment>
            ))}
          </div>
        ) : (
          <p className="tree-empty">No markdown files found in the configured notebook roots.</p>
        )}
      </div>
    </aside>
  )
}

function ExplorerDirectoryNode(props: {
  node: MarkdownExplorerDirectory
  mode: MarkdownPreviewMode
  theme: MarkdownPreviewTheme
}) {
  const { node, mode, theme } = props

  return (
    <details className="tree-directory" data-current-branch={String(node.isCurrentBranch)} open={node.isCurrentBranch}>
      <summary>
        <span className="tree-chevron">▸</span>
        <span className="tree-label">{node.name}</span>
      </summary>
      <div className="tree-children">
        {node.children.map((child) => {
          if (child.type === 'directory') {
            return (
              <React.Fragment key={child.relativePath}>
                <ExplorerDirectoryNode node={child} mode={mode} theme={theme} />
              </React.Fragment>
            )
          }

          return (
            <a
              key={child.relativePath}
              className="tree-file"
              data-current={String(child.isCurrent)}
              href={buildMarkdownPreviewPath(child.relativePath, { theme, mode })}
            >
              <span className="tree-file-icon">md</span>
              <span className="tree-label">{child.name}</span>
            </a>
          )
        })}
      </div>
    </details>
  )
}
