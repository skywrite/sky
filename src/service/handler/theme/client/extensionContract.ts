/**
 * What an extension's screens are handed and what they may export. Types
 * only: this file is the contract Sky publishes as `@skywrite/core/extensions`,
 * so an extension imports these instead of redeclaring them.
 *
 * An extension's `ui/index.tsx` exports any of the members of
 * `ExtensionModule`, and Sky places each one.
 */

import type { ComponentType, Key, ReactNode } from 'react'

/** What running one of the extension's commands answers: the command's result and the lines it printed. */
export interface RunAnswer {
  status: 'success' | 'fail' | 'error'
  // deno-lint-ignore no-explicit-any
  data?: any
  message?: string
  log: string[]
}

/** Runs one of the extension's own commands the way the terminal would. */
export type Run = (command: string, args?: Record<string, unknown>) => Promise<RunAnswer>

/** The person or organization whose page a card sits on. */
export interface ProfileRef {
  /** Notebook-relative file */
  id: string
  type: 'person' | 'org'
  name: string
}

/** The pieces the settings pages are built from, so an extension's page looks like the rest. */
export interface SettingsKit {
  Block: ComponentType<{ key?: Key | null; head?: ReactNode; note?: string; children: ReactNode }>
  Row: ComponentType<{ key?: Key | null; label: ReactNode; sub?: ReactNode; children?: ReactNode; last?: boolean }>
  mono: (text: string) => ReactNode
}

export interface ExtensionModule {
  /** A card on a person's or an organization's page. */
  ProfileCard?: ComponentType<{ profile: ProfileRef; run: Run }>
  /** A control in a file's header, on the files `appliesTo` says (every file when it does not). */
  FileAction?: ComponentType<{ file: string; run: Run }>
  /** A card in a file's column, on the files `appliesTo` says. A meeting's page shows these. */
  FileCard?: ComponentType<{ file: string; run: Run }>
  appliesTo?: (file: string) => boolean
  /** Its page under Settings › Extensions. */
  Settings?: ComponentType<{ run: Run; ui: SettingsKit }>
  /** A page of its own, reached from the sidebar entry `nav` names. */
  Page?: ComponentType<{ run: Run; navigate: (to: string) => void }>
  nav?: { label: string }
}
