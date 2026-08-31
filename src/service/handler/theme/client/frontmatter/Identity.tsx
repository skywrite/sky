/**
 * The identity line under a document's title: the keys that say what this is — when, with whom,
 * what kind, where — as one compact row, editable in place; the long text folded beneath.
 */

import type React from 'react'
import { Fragment, useRef } from 'react'
import { homeOf } from './kinds.ts'
import { isEmptyRow } from './model.ts'
import { PropRow } from './rows.tsx'
import type { FrontmatterState } from './useFrontmatter.ts'

export function IdentityLine({
  state,
  file,
  onLeave,
}: {
  state: FrontmatterState
  file: string
  /** Editing: Down on the last field — the caret goes on to the document */
  onLeave?: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  // Reading shows what is there; editing shows every field, empty ones included.
  const shown = state.readOnly ? state.rows.filter((row) => !isEmptyRow(row)) : state.rows
  const identity = shown.filter((row) => homeOf(row.kind) === 'identity')
  const below = shown.filter((row) => homeOf(row.kind) === 'below')
  if (identity.length === 0 && below.length === 0) return null
  /** Up and Down move between the fields; past the last one the document takes over. */
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return
    const target = event.target
    if (!(target instanceof HTMLInputElement)) return
    const inputs = [...(ref.current?.querySelectorAll<HTMLElement>('input, textarea') ?? [])]
    const index = inputs.indexOf(target)
    if (index === -1) return
    event.preventDefault()
    const next = inputs[index + (event.key === 'ArrowDown' ? 1 : -1)]
    if (next) next.focus()
    else if (event.key === 'ArrowDown') onLeave?.()
  }
  return (
    <div
      ref={ref}
      className="sky-identity"
      data-readonly={state.readOnly ? 'true' : undefined}
      onKeyDown={state.readOnly ? undefined : onKeyDown}
    >
      {identity.length > 0 ? (
        <div className="sky-identity-facts">
          {identity.map((row) => (
            <Fragment key={row.key}>
              <PropRow
                row={row}
                file={file}
                readOnly={state.readOnly}
                resolved={state.resolved}
                focusKey={state.focusKey}
                body={state.body}
                commit={state.commit}
              />
            </Fragment>
          ))}
        </div>
      ) : null}
      {below.map((row) => (
        <div key={row.key} className="sky-identity-below">
          <PropRow
            row={row}
            file={file}
            readOnly={state.readOnly}
            resolved={state.resolved}
            focusKey={state.focusKey}
            body={state.body}
            commit={state.commit}
          />
        </div>
      ))}
    </div>
  )
}
