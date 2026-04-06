import { fetchOpenProjectDirs } from '#lib/notebook/projects.ts'

// not used, just pulled from the extension directly

export default async function projectsResolver(): Promise<string[]> {
  const projects = await fetchOpenProjectDirs()
  return Array.from(projects.keys())
}
