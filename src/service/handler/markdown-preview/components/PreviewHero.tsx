import React from 'react'
import { buildMarkdownPreviewPath } from '../request.ts'
import { MARKDOWN_PREVIEW_THEMES, type MarkdownPreviewMode, type MarkdownPreviewTheme } from '../types.ts'

interface PreviewHeroProps {
  eyebrow: string
  title: string
  description: string
  metaLabel: string
  metaValue: string
  themePath: string
  pdfExportPath?: string
  mode: MarkdownPreviewMode
  canEdit: boolean
  theme: MarkdownPreviewTheme
}

export function PreviewHero(props: PreviewHeroProps) {
  const { eyebrow, title, description, metaLabel, metaValue, themePath, pdfExportPath, mode, canEdit, theme } = props

  return (
    <section className="hero">
      <div className="hero-copy">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <aside className="meta-panel">
        <p className="meta-label">{metaLabel}</p>
        <p className="path-chip">{metaValue}</p>
        {canEdit && (
          <div className="mode-toggle">
            <a
              className="mode-link"
              data-current={String(mode === 'preview')}
              href={buildMarkdownPreviewPath(themePath, { theme, mode: 'preview' })}
            >
              Preview
            </a>
            <a
              className="mode-link"
              data-current={String(mode === 'edit')}
              href={buildMarkdownPreviewPath(themePath, { theme, mode: 'edit' })}
            >
              Edit
            </a>
          </div>
        )}
        <div className="font-size-controls">
          <p className="meta-label">Text Size</p>
          <div className="font-size-buttons">
            <button className="font-size-button" type="button" data-font-scale-action="decrease">
              A-
            </button>
            <button className="font-size-button" type="button" data-font-scale-action="reset">
              100%
            </button>
            <button className="font-size-button" type="button" data-font-scale-action="increase">
              A+
            </button>
            <span className="font-size-value" data-font-scale-label>
              100%
            </span>
          </div>
        </div>
        {pdfExportPath ? (
          <div className="font-size-controls">
            <p className="meta-label">Export</p>
            <div className="font-size-buttons">
              <button className="font-size-button" type="button" data-pdf-export-path={pdfExportPath}>
                PDF
              </button>
              <span className="font-size-value pdf-export-status" data-pdf-export-status />
            </div>
          </div>
        ) : null}
        <div className="theme-list">
          {MARKDOWN_PREVIEW_THEMES.map((option) => {
            return (
              <a
                key={option}
                className="theme-link"
                data-current={String(option === theme)}
                href={buildMarkdownPreviewPath(themePath, { theme: option, mode })}
              >
                {option}
              </a>
            )
          })}
        </div>
      </aside>
    </section>
  )
}
