import React from 'react'

interface FrontmatterPanelProps {
  frontmatter: string
}

export function FrontmatterPanel(props: FrontmatterPanelProps) {
  const { frontmatter } = props

  if (frontmatter.length === 0) return null

  return (
    <details id="frontmatter-panel" className="frontmatter">
      <summary>YAML frontmatter</summary>
      <pre id="frontmatter-content">{frontmatter}</pre>
    </details>
  )
}
