import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { HomePage, type HomePageData } from './components/HomePage.tsx'
import { recentDocuments } from './recents.ts'
import { buildTodaySection } from './today.ts'

export { searchNotebook, type HomeSearchResult } from './searchNotebook.ts'
export type { HomePageData }

export interface HomePageOptions {
  markdownStore: MarkdownStore | null
  markdownBaseDir: string
}

/** Gather everything the home page shows. Impure: reads the notebook. */
export async function buildHomePageData(options: HomePageOptions): Promise<HomePageData> {
  const { markdownStore, markdownBaseDir } = options

  let today: HomePageData['today'] = null
  try {
    today = await buildTodaySection(markdownBaseDir)
  } catch {
    today = null
  }

  return {
    today,
    recents: markdownStore ? recentDocuments(markdownStore, markdownBaseDir) : [],
    counts: markdownStore
      ? {
          documents: markdownStore.time.size,
          people: markdownStore.people.size,
          orgs: markdownStore.orgs.size,
          projects: markdownStore.projects.size,
        }
      : null,
    searchEnabled: markdownStore !== null,
  }
}

/** Render the home page HTML. Pure: everything comes from `data`. */
export function renderHomePage(data: HomePageData): string {
  return '<!DOCTYPE html>' + renderToStaticMarkup(React.createElement(HomePage, { data }))
}
