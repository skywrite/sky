import * as path from 'node:path'
import { DIR_PROJECTS_OPEN } from '#config'
import { exists, readTextFile, walk } from '#shared/fs/mod.ts'
import { Document } from '#shared/models/Markdown/mod.ts'

export async function fetchOpenProjectDirs(projectsDir = DIR_PROJECTS_OPEN): Promise<Map<string, string>> {
  const openProjects = new Map<string, string>()

  for await (const entry of walk(projectsDir)) {
    if (!entry.isDirectory) continue

    const projectOverviewFile = path.join(entry.path, 'overview.md')
    // check is it a `_project/` dir?
    if (!(await exists(projectOverviewFile))) continue

    const projectInfoContents = await readTextFile(projectOverviewFile)
    const doc = await Document.fromMarkdown(projectInfoContents)

    const projectName = doc.yaml.name as string
    if (!projectName) {
      console.warn(`${entry.path} project has no name.`)
      continue
    }

    let projectDir = entry.path.replace('_project', '')
    projectDir = path.normalize(projectDir)

    openProjects.set(projectName, projectDir)
  }

  return openProjects
}
