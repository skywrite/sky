/**
 * The installed extensions' screens. As written this lists none; the
 * service's bundle build replaces this file's contents with one import per
 * installed extension that has a ui/index.tsx (theme/mod.ts).
 */

import type { ExtensionModule } from './extensions.tsx'

export interface GeneratedExtension {
  /** `author/slug` */
  id: string
  slug: string
  /** The display name */
  name: string
  ui: ExtensionModule
}

export const extensionModules: GeneratedExtension[] = []
