import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { chromium } from 'playwright'
import { generateText } from 'ai'
import { aiModel } from '#shared/ai/models.ts'
import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { exists, outputFile, readTextFile } from '#shared/fs/mod.ts'
import { parseCsv, stringifyCsv } from '#universal/encoding/csv/mod.ts'
import { dateToLocalString } from '#universal/dates/mod.ts'

const params = {
  username: Flag.string('Twitter username to fetch stats for', { short: 'u', required: true }),
}

type Params = InferParams<typeof params>

export default class XFollowersTask extends Command {
  static override description: CommandDescription = {
    name: 'x:followers',
    description: 'Fetch X (Twitter) profile stats (followers, following) using Playwright.',
    params,
  }

  async run({ context, args }: CommandArgs<Params>): Promise<CommandResult> {
    const { output } = context
    const username = args.username

    output.log(`Fetching stats for @${username}...`)

    let browser
    try {
      // Navigate to profile
      const { browser: br, page, profileUrl } = await this.navigateToProfile(username, output)
      browser = br

      // Extract follower and following counts
      const followerCountFromVision = await this.extractCountWithVision(
        page,
        'a[href*="/verified_followers"], a[href*="/followers"]:not([href*="/following"])',
        '/tmp/twitter-follower-tooltip.png',
        'Look at this screenshot of a Twitter/X profile. Find the tooltip showing the exact follower count (it will be a number with commas like "14,072"). Return ONLY the number with commas, nothing else.',
      )

      const followingCountFromVision = await this.extractCountWithVision(
        page,
        'a[href*="/following"]',
        '/tmp/twitter-following-tooltip.png',
        'Look at this screenshot of a Twitter/X profile. Find the tooltip showing the exact following count (it will be a number with commas like "1,028"). Return ONLY the number with commas, nothing else.',
      )

      // Fallback to DOM scraping if vision extraction failed
      const domStats = await this.extractCountsFromDOM(page)

      // Use vision-extracted counts if available, otherwise fall back to DOM scraping
      const followers = followerCountFromVision || domStats.followers.count
      const following = followingCountFromVision || domStats.following.count

      await browser.close()

      output.log(`Followers: ${followers}`)
      output.log(`Following: ${following}`)

      // Save to CSV
      await this.saveToCSV(context, username, followers, following, output)

      return CommandResult.success({
        username,
        followers,
        following,
        url: profileUrl,
      })
    } catch (error) {
      if (browser) {
        await browser.close()
      }
      throw error
    }
  }

  private async navigateToProfile(username: string, output: any) {
    const browser = await chromium.launch({
      headless: true,
      executablePath: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    })
    const page = await browser.newPage()

    const profileUrl = `https://x.com/${username}`
    output.log(`Navigating to ${profileUrl}`)
    await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })

    // Wait for the stats to load (increased from 3s to 5s for reliability)
    await page.waitForTimeout(5000)

    return { browser, page, profileUrl }
  }

  private async extractCountWithVision(
    page: any,
    linkSelector: string,
    screenshotPath: string,
    prompt: string,
  ): Promise<string | null> {
    const link = page.locator(linkSelector).first()
    const box = await link.boundingBox().catch(() => null)

    if (!box) return null

    // Hover and screenshot
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.waitForTimeout(2000)

    await page.screenshot({
      path: screenshotPath,
      clip: {
        x: Math.max(0, box.x - 100),
        y: Math.max(0, box.y - 100),
        width: Math.min(400, box.width + 200),
        height: Math.min(400, box.height + 200),
      },
    })

    // Extract with the vision model
    try {
      const imageData = await readFile(screenshotPath)
      const { text } = await generateText({
        ...aiModel('vision'),
        messages: [
          {
            role: 'user',
            content: [
              { type: 'file' as const, data: imageData, mediaType: 'image/png' },
              { type: 'text' as const, text: prompt },
            ],
          },
        ],
      })

      const extractedCount = text.trim()
      if (extractedCount && /[\d,]+/.test(extractedCount)) {
        return extractedCount
      }
    } catch {
      // Vision extraction failed, will fall back to DOM scraping
    }

    return null
  }

  private async extractCountsFromDOM(page: any) {
    // deno-lint-ignore no-explicit-any
    return await page.evaluate((): any => {
      // This callback runs in browser context via Playwright - DOM types are available at runtime
      const followerLink =
        (globalThis as any).document.querySelector('a[href*="/verified_followers"]') ||
        (globalThis as any).document.querySelector('a[href*="/followers"]:not([href*="/following"])')

      const followingLink = (globalThis as any).document.querySelector('a[href*="/following"]')

      const extractCount = (link: any, type: string) => {
        if (!link) return { count: null, method: 'no-link' }

        // Strategy 1: Check the link itself for title
        const linkTitle = link.getAttribute('title')
        if (linkTitle && /[\d,]/.test(linkTitle)) {
          return { count: linkTitle, method: 'link-title' }
        }

        // Strategy 2: Look for title attribute in ANY descendant (including the element itself)
        const allElements = [link, ...Array.from(link.querySelectorAll('*'))]
        for (const el of allElements) {
          const title = el.getAttribute('title')
          if (title && /[\d,]/.test(title)) {
            return { count: title, method: 'child-title' }
          }
        }

        // Strategy 3: Look specifically for the span containing the count (e.g., "14K")
        // This span might have a title attribute
        const spans = link.querySelectorAll('span')
        for (const span of Array.from(spans) as any[]) {
          const spanTitle = span.getAttribute('title')
          if (spanTitle && /[\d,]/.test(spanTitle)) {
            return { count: spanTitle, method: 'span-title' }
          }

          // Also check if this span contains a number-like text and has a title on itself or parent
          const spanText = span.textContent || ''
          if (/[\d,\.]+[KMB]?/.test(spanText)) {
            const parentTitle = span.parentElement?.getAttribute('title')
            if (parentTitle && /[\d,]/.test(parentTitle)) {
              return { count: parentTitle, method: 'parent-title' }
            }
          }
        }

        // Strategy 4: Check aria-label
        const ariaLabel = link.getAttribute('aria-label')
        if (ariaLabel) {
          const match = ariaLabel.match(/([\d,]+)/)
          if (match) return { count: match[1], method: 'aria-label' }
        }

        // Strategy 5: Parse text content (fallback)
        const text = link.textContent || ''
        const textMatch = text.match(/([\d,\.]+[KMB]?)/)
        return textMatch ? { count: textMatch[1], method: 'text-content' } : { count: null, method: 'not-found' }
      }

      return {
        followers: extractCount(followerLink, 'followers'),
        following: extractCount(followingLink, 'following'),
      }
    })
  }

  private async saveToCSV(
    context: any,
    username: string,
    followers: string | null,
    following: string | null,
    output: any,
  ) {
    const now = new Date()
    const year = now.getFullYear()
    const whenStr = dateToLocalString(now)
    const csvFile = path.join(<string>context.config.DIR_TRACKING, 'social', 'x', String(year), 'followers.csv')

    const columns = ['when', 'username', 'followers', 'following']
    const csvExists = await exists(csvFile)
    if (!csvExists) {
      const headerString = columns.join(',')
      const emptyCsvData = `${headerString}\n`
      await outputFile(csvFile, emptyCsvData)
    }

    let csvData = await readTextFile(csvFile)
    const csvRecords = parseCsv(csvData).records as Record<string, unknown>[]

    // Remove commas from numbers for CSV storage
    const followersNum = followers ? followers.replace(/,/g, '') : ''
    const followingNum = following ? following.replace(/,/g, '') : ''

    const newRecord = {
      when: whenStr,
      username,
      followers: followersNum,
      following: followingNum,
    }
    csvRecords.push(newRecord)

    csvData = stringifyCsv(csvRecords, columns)
    await outputFile(csvFile, csvData)

    output.log(`Saved to ${csvFile}`)
  }
}
