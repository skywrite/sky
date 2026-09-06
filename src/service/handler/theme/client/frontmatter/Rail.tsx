/**
 * The rail beside a document: what is about it rather than part of it — tags, the documents it
 * links to and the ones that link here, its files, its outline, and the kept dates with the raw
 * YAML behind a switch. Editable in place; below 1180px it is an overlay, opened from the chevron
 * at the header's end.
 */

import { Fragment, type ReactNode, useEffect, useState } from 'react'
import { RailToggle } from '../railToggle.tsx'
import { AttachFiles } from './attach.tsx'
import { type Backlink, fetchBacklinks } from './complete.ts'
import { homeOf, kindOf, railSectionOf, TYPE_MARKS } from './kinds.ts'
import { addAttachment, addKey, isEmptyRow, removeAttachment } from './model.ts'
import { AddProperty, hrefOf, PropRow, YamlFace } from './rows.tsx'
import type { FrontmatterState } from './useFrontmatter.ts'

export interface OutlineItem {
  level: number
  text: string
  /** Scrolls the heading into view */
  go: () => void
  current: boolean
}

type Face = 'properties' | 'yaml'
const FACE_KEY = 'sky-frontmatter-face'
const BACKLINKS_SHOWN = 10

function rememberedFace(): Face {
  try {
    return sessionStorage.getItem(FACE_KEY) === 'yaml' ? 'yaml' : 'properties'
  } catch {
    return 'properties'
  }
}

function rememberFace(face: Face) {
  try {
    sessionStorage.setItem(FACE_KEY, face)
  } catch {
    // Then the face lasts for this page only.
  }
}

/** What points at the document, fetched when the path or the front matter changes. */
function useBacklinks(file: string, version: string): { items: Backlink[]; total: number } {
  const [found, setFound] = useState<{ items: Backlink[]; total: number }>({ items: [], total: 0 })
  useEffect(() => {
    let alive = true
    void fetchBacklinks(file).then((result) => {
      if (alive) setFound(result)
    })
    return () => {
      alive = false
    }
  }, [file, version])
  return found
}

function chipCount(rows: FrontmatterState['rows']): number {
  return rows.reduce((n, r) => n + (Array.isArray(r.value) ? r.value.length : 0), 0)
}

/** A file name written as words: `email_Jane-Doe_Pricing-thread` reads as "email · Jane Doe · Pricing thread". */
function readableLabel(label: string): string {
  if (!label.includes('_') && !label.includes('-')) return label
  return label
    .split('_')
    .map((part) => part.replace(/-/g, ' ').trim())
    .filter((part) => part.length > 0)
    .join(' · ')
}

function Section({
  title,
  count,
  children,
  extra,
}: {
  title: string
  count?: number
  children: ReactNode
  extra?: ReactNode
}) {
  return (
    <section className="sky-rail-sec" data-section={title.toLowerCase().replace(/\s+/g, '-')}>
      <h2 className="sky-rail-sec-h">
        <span>{title}</span>
        {count !== undefined ? <span className="sky-rail-count">{count}</span> : null}
        {extra}
      </h2>
      {children}
    </section>
  )
}

export function DocumentRail({
  state,
  file,
  day,
  outline,
  onToggle,
}: {
  state: FrontmatterState
  file: string
  /** The day a document under time/ belongs to, when it does */
  day?: string | null
  outline: OutlineItem[]
  /** Folds the rail away — the chevron in its corner. Absent where the rail sits inline, under a heading of its own. */
  onToggle?: () => void
}) {
  const dir = file.split('/')[0] ?? ''
  const [face, setFace] = useState<Face>(rememberedFace)
  const [allBacklinks, setAllBacklinks] = useState(false)
  const backlinks = useBacklinks(file, state.body)
  const shownFace: Face = state.error && face === 'properties' ? 'yaml' : face
  const choose = (next: Face) => {
    setFace(next)
    rememberFace(next)
  }
  const railRows = state.rows.filter(
    (row) => homeOf(row.kind) === 'rail' && (!state.readOnly || !isEmptyRow(row) || row.kind === 'auto'),
  )
  const rowsOf = (section: ReturnType<typeof railSectionOf>) =>
    railRows.filter((row) => railSectionOf(row.kind) === section)
  const tags = rowsOf('tags')
  const links = rowsOf('links')
  const files = rowsOf('files')
  const document = rowsOf('document')
  const present = new Set<string>(state.rows.map((row) => row.key))
  const readOnly = state.readOnly
  // A file can be added while editing, as long as the front matter reads as rows to list it in.
  const canAttach = !readOnly && !state.error
  const row = (r: (typeof state.rows)[number]) => (
    <Fragment key={r.key}>
      <PropRow
        row={r}
        file={file}
        readOnly={readOnly}
        resolved={state.resolved}
        focusKey={state.focusKey}
        body={state.body}
        commit={state.commit}
      />
    </Fragment>
  )
  const shownBacklinks = allBacklinks ? backlinks.items : backlinks.items.slice(0, BACKLINKS_SHOWN)

  return (
    <aside className="sky-rail" data-readonly={readOnly ? 'true' : undefined} aria-label="Details">
      {onToggle ? (
        <div className="sky-rail-head">
          <RailToggle open onClick={onToggle} />
        </div>
      ) : null}
      {tags.length > 0 || !readOnly ? (
        <Section title="Tags">
          {tags.length > 0 ? tags.map(row) : <p className="sky-rail-empty">No tags yet.</p>}
        </Section>
      ) : null}
      {links.length > 0 || !readOnly ? (
        <Section title="Links" count={chipCount(links)}>
          {links.length > 0 ? links.map(row) : <p className="sky-rail-empty">Nothing linked yet.</p>}
        </Section>
      ) : null}
      {backlinks.total > 0 ? (
        <Section title="Linked from" count={backlinks.total}>
          <ul className="sky-backlinks">
            {shownBacklinks.map((item) => (
              <li key={item.path}>
                <a className="sky-backlink" href={hrefOf(item.path)}>
                  <span className="sky-prop-mark">{TYPE_MARKS[item.type] ?? ''}</span>
                  <span className="sky-backlink-label">{readableLabel(item.label)}</span>
                  <span className="sky-backlink-date">{item.date ? item.date.slice(5) : item.via}</span>
                </a>
              </li>
            ))}
          </ul>
          {backlinks.items.length > BACKLINKS_SHOWN && !allBacklinks ? (
            <button type="button" className="sky-rail-more" onClick={() => setAllBacklinks(true)}>
              {backlinks.total - BACKLINKS_SHOWN} more…
            </button>
          ) : null}
        </Section>
      ) : null}
      {files.length > 0 || canAttach || day ? (
        <Section title="Files" count={chipCount(files) || undefined}>
          {files.map(row)}
          {files.length === 0 && !canAttach ? <p className="sky-rail-empty">No files yet.</p> : null}
          {canAttach ? (
            <AttachFiles
              file={file}
              listed={files.flatMap((r) => (Array.isArray(r.value) ? r.value : []))}
              onAdd={(name) => state.update((body) => addAttachment(body, name))}
              onRemove={(name) => state.update((body) => removeAttachment(body, name))}
            />
          ) : null}
          {/* A note of a day: the day's files, all of them, as a page. */}
          {day ? (
            <a className="sky-rail-more sky-rail-all-files" href={`/${day}/files`}>
              All of the day’s files…
            </a>
          ) : null}
        </Section>
      ) : null}
      {outline.length > 1 ? (
        <Section title="Outline">
          <ul className="sky-outline">
            {outline.map((item, index) => (
              <li key={index} className={`l${item.level}${item.current ? ' on' : ''}`}>
                <button type="button" onClick={item.go}>
                  {item.text}
                </button>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      <Section
        title="Document"
        extra={
          <span className="sky-props-faces" role="group" aria-label="Front matter face">
            <button
              type="button"
              data-face="properties"
              aria-pressed={shownFace === 'properties'}
              onClick={() => choose('properties')}
            >
              Rows
            </button>
            <button type="button" data-face="yaml" aria-pressed={shownFace === 'yaml'} onClick={() => choose('yaml')}>
              YAML
            </button>
          </span>
        }
      >
        {shownFace === 'yaml' ? (
          <YamlFace text={state.body} readOnly={readOnly} onCommit={state.commit} />
        ) : (
          <>
            {document.map(row)}
            <div className="sky-prop" data-key="path" data-kind="auto">
              <span className="sky-prop-key">path</span>
              <div className="sky-prop-value">
                <span className="sky-prop-text auto">{file}</span>
              </div>
            </div>
            {!readOnly ? (
              <div className="sky-props-add">
                <AddProperty
                  dir={dir}
                  present={present}
                  onAdd={(key) => {
                    state.setFocusKey(key)
                    state.commit(addKey(state.body, key, kindOf(key, 'missing')))
                  }}
                />
              </div>
            ) : null}
          </>
        )}
      </Section>
    </aside>
  )
}
