import type { Page } from 'playwright'
import { z } from 'zod'
import { linkedInUrl } from './types.ts'

export const ProfileEvidence = z.object({
  url: z.string().max(8000),
  name: z.string().max(1000),
  text: z.string().max(60_000),
  companies: z.array(z.object({ name: z.string().max(1000), url: z.string().max(8000) })).max(100),
})
export type ProfileEvidence = z.infer<typeof ProfileEvidence>

/** LinkedIn also renders profile names as accessible headings or plain text in its newer layout. */
export async function visibleProfileName(page: Page): Promise<string | null> {
  const main = page.locator('main, [role="main"]').first()
  if (!(await main.isVisible())) return null
  const title = (await page.title()).replace(/^\(\d+\)\s*/, '')
  const profileTitle = title.match(/^(.+?)\s*[|–—]\s*LinkedIn\s*$/i)?.[1].trim()
  const validName = (name: string) =>
    name &&
    !/^(?:LinkedIn|Sign in|Log in|Join|Security|Verification|Page not found|Profile unavailable)(?:\b|$)/i.test(name)
  const primary = await main.locator('h1, [role="heading"][aria-level="1"]').filter({ visible: true }).allTextContents()
  const heading = primary.map((text) => text.trim()).find(validName)
  if (heading) return heading.slice(0, 1000)
  if (!profileTitle || !validName(profileTitle)) return null
  const named = main.getByText(profileTitle, { exact: true }).first()
  if (await named.isVisible()) return profileTitle.slice(0, 1000)
  const headings = await main.locator('h2, h3, [role="heading"]').filter({ visible: true }).allTextContents()
  return (
    headings
      .map((text) => text.trim())
      .find((text) => text && (profileTitle === text || profileTitle.startsWith(`${text} - `)))
      ?.slice(0, 1000) ?? null
  )
}

/** Only the selected person's main content, excluding authentication controls and surrounding navigation. */
export async function readProfileEvidence(page: Page, url: string): Promise<ProfileEvidence> {
  const name = await visibleProfileName(page)
  if (!name) throw new Error('LinkedIn profile heading unavailable')
  const captured = await page
    .locator('main, [role="main"]')
    .first()
    .evaluate((element) => {
      const ignored = 'aside, nav, footer, script, style, form, input, textarea, [aria-hidden="true"]'
      const clone = element.cloneNode(true) as HTMLElement
      clone.querySelectorAll(ignored).forEach((node) => node.remove())
      clone.querySelectorAll('section').forEach((section) => {
        const heading = section.querySelector('h2')?.textContent ?? ''
        if (
          /people also|you may know|suggested for you|more profiles|interests|recommendations|activity/i.test(heading)
        )
          section.remove()
      })
      const companies = Array.from(element.querySelectorAll<HTMLAnchorElement>('a[href*="/company/"]'))
        .filter((anchor) => !anchor.closest(ignored) && anchor.getClientRects().length > 0)
        .slice(0, 100)
        .map((anchor) => ({ name: anchor.innerText.trim().slice(0, 1000), url: anchor.href }))
      // textContent on a detached clone loses block boundaries; make those explicit.
      clone.querySelectorAll('p, li, h1, h2, h3, div, section').forEach((node) => node.append('\n'))
      return { text: clone.textContent ?? '', companies }
    })
  return {
    url,
    name,
    text: captured.text
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n/g, '\n')
      .trim()
      .slice(0, 60_000),
    companies: captured.companies.flatMap((company) => {
      try {
        return [{ ...company, url: linkedInUrl(company.url, 'org') }]
      } catch {
        return []
      }
    }),
  }
}
