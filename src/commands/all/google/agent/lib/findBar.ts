import type { Page } from 'playwright'

// The Docs find bar is real DOM (unlike the canvas), so it can be driven
// deterministically: fill() the input — atomic, no focus race, no keystrokes
// leaking into the document — then read the "k of n" match counter and press
// Enter until it SAYS the target occurrence. Probe-verified semantics
// (2026-08-07): filling focuses match 1, each Enter advances one match,
// wrapping past n. Selectors carry old-UI fallbacks; aria-label assumes an
// English Google UI.

const FIND_INPUT = 'input[aria-label="Find in document"], .docs-findinput-input'
const FIND_COUNTER = '[class*="FindInputCounter"], [class*="findinput-count"]'
const COUNTER_RE = /^(\d+) of (\d+)$/

/**
 * Open find, select the Nth match of searchText, and close the bar — the
 * match stays selected in the canvas. Throws when the counter never appears
 * (no matches) or holds fewer matches than the requested occurrence; callers
 * pre-verify existence API-side, so a throw here means the live document
 * disagrees with that check. On multi-tab docs pass expectTabId (the tab the
 * caller navigated to): if the selection lands the editor in a different tab
 * — find can jump tabs — this throws before anything types into it.
 */
export async function selectDocMatch(
  page: Page,
  searchText: string,
  occurrence: number,
  expectTabId?: string,
): Promise<void> {
  await page.keyboard.press('Meta+KeyF')
  const input = page.locator(FIND_INPUT).first()
  await input.waitFor({ state: 'visible', timeout: 5000 })
  await input.fill(searchText)

  const counter = page.locator(FIND_COUNTER).first()
  const read = async (): Promise<{ at: number; total: number } | null> => {
    const text = (await counter.textContent().catch(() => null))?.trim() ?? ''
    const match = COUNTER_RE.exec(text)
    return match ? { at: Number(match[1]), total: Number(match[2]) } : null
  }

  let state: { at: number; total: number } | null = null
  for (let i = 0; i < 20 && !state; i++) {
    await page.waitForTimeout(250)
    state = await read()
  }
  if (!state) throw new Error(`the find counter never appeared for "${searchText}" — no matches in the live document`)
  if (state.total < occurrence) {
    throw new Error(
      `the live document has ${state.total} match(es) of "${searchText}" — occurrence ${occurrence} does not exist`,
    )
  }

  // Closed loop: advance until the counter reads the target, bounded by one
  // full wrap so a stuck counter cannot spin forever.
  for (let presses = 0; state.at !== occurrence; presses++) {
    if (presses > state.total + 2) {
      throw new Error(`the find counter never reached ${occurrence} of ${state.total} for "${searchText}"`)
    }
    await input.press('Enter')
    await page.waitForTimeout(300)
    state = (await read()) ?? state
  }

  // Closing the find bar keeps the current match selected in the canvas.
  await page.keyboard.press('Escape')
  await page.waitForTimeout(600)

  // The editor rewrites ?tab= in the URL when a match pulls it to another
  // tab; if it no longer names the requested tab, the selection is in the
  // wrong one. (No tab param in the URL proves nothing — skip the check.)
  if (expectTabId) {
    const activeTab = new URL(page.url()).searchParams.get('tab')
    if (activeTab && activeTab !== expectTabId) {
      throw new Error(
        `the find selection landed in tab ${activeTab}, not ${expectTabId} — "${searchText}" was not found in the requested tab`,
      )
    }
  }
}
