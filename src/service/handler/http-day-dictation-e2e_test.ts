import { readFile } from 'node:fs/promises'
import type { Locator, Page } from 'playwright'
import type { MIDraftInput } from '#lib/mostImportant/types.ts'
import { dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

const DAY = new PlainDate('2026-01-27')
const EMPTY = '---\nstarted: 08:00\ntz: UTC\n---\n\n# 2026-01-27\n'
interface AudioFixture {
  tracks: MediaStreamTrack[]
  channel?: RTCDataChannel
  peer?: RTCPeerConnection
  commits: number
  deny: boolean
  defer: boolean
  grant?: () => void
  twoWayOffer?: boolean
  volume?: (value: number) => void
}
type DictationWindow = Window & { entryAudio: AudioFixture }

/** The second peer plays OpenAI locally. The app still negotiates SDP, sends its track and commits over SCTP. */
async function connectPeers(page: Page) {
  await page.addInitScript(() => {
    const fixture: AudioFixture = { tracks: [], commits: 0, deny: false, defer: false }
    Object.defineProperty(window, 'entryAudio', { value: fixture })
    const context = new AudioContext()
    const tone = context.createOscillator()
    const gain = context.createGain()
    gain.gain.value = 0
    tone.connect(gain)
    tone.start()
    fixture.volume = (value) => {
      gain.gain.value = value
    }
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: async () => {
        if (fixture.deny) throw new DOMException('Denied', 'NotAllowedError')
        if (fixture.defer)
          await new Promise<void>((resolve) => {
            fixture.grant = resolve
          })
        await context.resume()
        const destination = context.createMediaStreamDestination()
        gain.connect(destination)
        const stream = destination.stream
        fixture.tracks.push(...stream.getTracks())
        return stream
      },
    })
  })
  await page.route('**/item/dictation', (route) => route.fulfill({ json: { value: 'synthetic-token' } }))
  await page.route('https://api.openai.com/v1/realtime/calls', async (route) => {
    const answer = await page.evaluate(async (sdp) => {
      const fixture = (window as unknown as DictationWindow).entryAudio
      const audio = sdp.split('\r\nm=').find((section) => section.startsWith('audio '))
      fixture.twoWayOffer = audio?.includes('\r\na=sendrecv\r\n')
      fixture.peer?.close()
      const peer = new RTCPeerConnection()
      fixture.peer = peer
      peer.ondatachannel = ({ channel }) => {
        fixture.channel = channel
        channel.onmessage = (message) => {
          if (JSON.parse(message.data).type === 'input_audio_buffer.commit') fixture.commits++
        }
      }
      await peer.setRemoteDescription({ type: 'offer', sdp })
      await peer.setLocalDescription(await peer.createAnswer())
      if (peer.iceGatheringState !== 'complete')
        await new Promise<void>((resolve) => {
          peer.onicegatheringstatechange = () => {
            if (peer.iceGatheringState === 'complete') resolve()
          }
        })
      return peer.localDescription!.sdp
    }, route.request().postData()!)
    await route.fulfill({ status: 201, contentType: 'application/sdp', body: answer })
  })
}

/** Measure what gets painted while the input is silent, across a full cycle of either motion preference. */
function sampleSilentWave(wave: Locator) {
  return wave.evaluate(async (element) => {
    const bars = Array.from(element.children)
    const lowest = bars.map(() => Infinity)
    const highest = bars.map(() => 0)
    let dimmest = 1
    let brightest = 0
    const end = performance.now() + 2100
    await new Promise<void>((resolve) => {
      const frame = (now: number) => {
        bars.forEach((bar, i) => {
          const height = bar.getBoundingClientRect().height
          lowest[i] = Math.min(lowest[i]!, height)
          highest[i] = Math.max(highest[i]!, height)
        })
        const opacity = Number(getComputedStyle(element).opacity)
        dimmest = Math.min(dimmest, opacity)
        brightest = Math.max(brightest, opacity)
        if (now < end) requestAnimationFrame(frame)
        else resolve()
      }
      requestAnimationFrame(frame)
    })
    return {
      travel: highest.map((height, i) => height - lowest[i]!),
      peak: Math.max(...highest),
      fade: brightest - dimmest,
    }
  })
}

function sendEvent(page: Page, event: object) {
  return page.evaluate((data) => {
    const { channel } = (window as unknown as DictationWindow).entryAudio
    channel!.send(JSON.stringify(data))
  }, event)
}

async function finishSpeech(page: Page, form: Locator, transcript: string) {
  const stop = form.getByRole('button', { name: 'Stop dictation', exact: true })
  await stop.waitFor()
  const partial = transcript.split(/\s+/).slice(0, 2).join(' ')
  await sendEvent(page, { type: 'conversation.item.input_audio_transcription.delta', item_id: 'word', delta: partial })
  await form
    .getByRole('group', { name: /^Live / })
    .getByText(partial, { exact: true })
    .waitFor()
  const commits = await page.evaluate(() => (window as unknown as DictationWindow).entryAudio.commits)
  await stop.click()
  await page.waitForFunction(
    (previous) => (window as unknown as DictationWindow).entryAudio.commits > previous,
    commits,
  )
  await sendEvent(page, { type: 'input_audio_buffer.committed', item_id: 'word' })
  await sendEvent(page, { type: 'conversation.item.input_audio_transcription.completed', item_id: 'word', transcript })
  await stop.waitFor({ state: 'detached' })
  await form.getByRole('button', { name: 'Finishing dictation' }).waitFor({ state: 'detached' })
}

test(
  {
    name: 'Done today streams dictation, releases the microphone on Stop, and saves the edited final text',
    timeout: 45_000,
  },
  async (t) => {
    await runWysiwygE2e(
      t,
      { initialMarkdown: EMPTY, tempPrefix: 'sky-entry-dictation-', file: 'time/' + dayFile(DAY), day: true },
      async ({ page, origin, file, errors }) => {
        await page.setViewportSize({ width: 390, height: 844 })
        await connectPeers(page)
        await page.goto(`${origin}/${DAY.ymd}?view=record`)
        const block = page.locator('.sky-block').filter({ has: page.locator('.sky-bhead', { hasText: 'Done today' }) })
        const mic = block.getByRole('button', { name: 'Dictate entry', exact: true })
        await mic.waitFor()
        const hit = await mic.boundingBox()
        const dayTitle = await page.title()
        await mic.click()
        const form = block.getByRole('form', { name: 'Add entry' })
        const stop = form.getByRole('button', { name: 'Stop dictation' })
        await stop.waitFor()
        const wave = form.locator('.sky-entry-wave')
        const middle = wave.locator('i').nth(2)
        const quiet = await sampleSilentWave(wave)
        assert({
          given: 'a phone-sized screen with silent input and no transcript',
          should: 'visibly change the height of all five bars by at least four CSS pixels',
          actual: [quiet.travel.length, Math.min(...quiet.travel) >= 4],
          expected: [5, true],
        })
        await page.evaluate(() => (window as unknown as DictationWindow).entryAudio.volume!(0.25))
        await form.locator('.sky-entry-wave[data-hearing="true"]').waitFor()
        await page.waitForFunction((quietPeak) => {
          const bar = document.querySelector('.sky-entry-wave i:nth-child(3)')
          return bar && bar.getBoundingClientRect().height > quietPeak * 2
        }, quiet.peak)
        await page.emulateMedia({ reducedMotion: 'reduce' })
        assert({
          given: 'a preference for reduced motion',
          should: 'keep the taller speaking bars stationary',
          actual: await middle.evaluate((bar) => getComputedStyle(bar).animationName),
          expected: 'none',
        })
        await page.evaluate(() => (window as unknown as DictationWindow).entryAudio.volume!(0))
        await form.locator('.sky-entry-wave[data-hearing="false"]').waitFor()
        const reduced = await sampleSilentWave(wave)
        assert({
          given: 'a pause in dictation with Reduce Motion enabled',
          should: 'gently fade the listening indicator while keeping the bars stationary',
          actual: [Math.max(...reduced.travel) < 0.5, reduced.fade >= 0.35],
          expected: [true, true],
        })
        await page.emulateMedia({ reducedMotion: 'no-preference' })
        const send = (event: object) => sendEvent(page, event)
        await send({
          type: 'conversation.item.input_audio_transcription.delta',
          item_id: 'a',
          delta: ' Reviewed the draft',
        })
        await form.getByText('Reviewed the draft', { exact: true }).waitFor()
        const add = form.getByRole('button', { name: 'Add entry', exact: true })
        assert({
          given: 'a single tap on the quiet mic and an unfinished transcript',
          should: 'show speech live, keep the keyboard closed, and leave the notebook untouched',
          actual: [
            hit?.width,
            hit?.height,
            await page.evaluate(() => (window as unknown as DictationWindow).entryAudio.twoWayOffer),
            await page.title(),
            await add.isDisabled(),
            await form.getByRole('textbox', { name: 'Item text' }).count(),
            await readFile(file, 'utf8'),
          ],
          expected: [44, 44, true, `sky · ${DAY.ymd} · Dictating entry`, true, 0, EMPTY],
        })
        await stop.click()
        await page.waitForFunction(() => (window as unknown as DictationWindow).entryAudio.commits === 1)
        assert({
          given: 'Stop before the provider has sent its correction',
          should: 'release the recording device immediately and wait to enable saving',
          actual: [
            await page.evaluate(() => (window as unknown as DictationWindow).entryAudio.tracks[0]!.readyState),
            await add.isDisabled(),
          ],
          expected: ['ended', true],
        })
        await send({ type: 'input_audio_buffer.committed', item_id: 'a' })
        await send({
          type: 'conversation.item.input_audio_transcription.completed',
          item_id: 'a',
          transcript: ' Reviewed the Atlas draft.',
        })
        const editor = form.getByRole('textbox', { name: 'Item text' })
        await editor.waitFor()
        assert({
          given: 'a final transcript that corrects the live text',
          should: 'replace the partial text once in an editable entry',
          actual: await editor.inputValue(),
          expected: 'Reviewed the Atlas draft.',
        })
        await editor.fill('Reviewed the updated draft. ')
        await form.getByRole('button', { name: 'Continue dictating' }).click()
        await stop.waitFor()
        await send({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'b', delta: ' Sent it.' })
        await form.getByText('Sent it.', { exact: true }).waitFor()
        await page.evaluate(() => (window as unknown as DictationWindow).entryAudio.channel!.close())
        await editor.waitFor()
        await form.getByRole('alert').filter({ hasText: 'connection closed' }).waitFor()
        assert({
          given: 'a dropped connection after dictating more into a hand-edited draft',
          should: 'keep both the edit and the words already received',
          actual: await editor.inputValue(),
          expected: 'Reviewed the updated draft. Sent it.',
        })
        await form.getByRole('textbox', { name: 'Entry time' }).fill('14:20')
        await add.click()
        await block.locator('.sky-prow').filter({ hasText: 'Reviewed the updated draft. Sent it.' }).waitFor()
        assert({
          given: 'the explicit Add entry action',
          should: 'save the reviewed words through the existing day flow and restore the day title',
          actual: [
            (await readFile(file, 'utf8')).includes('14:20 > Reviewed the updated draft. Sent it.'),
            await page.title(),
            errors,
          ],
          expected: [true, dayTitle, []],
        })
        await page.evaluate(() => {
          ;(window as unknown as DictationWindow).entryAudio.deny = true
        })
        await mic.click()
        await form.getByRole('alert').filter({ hasText: 'Microphone access was refused' }).waitFor()
        await editor.fill('Typed entry')
        await form.getByRole('button', { name: 'Cancel', exact: true }).click()
        await mic.waitFor()
        assert({
          given: 'microphone permission denied and a canceled typed draft',
          should: 'leave the existing entry intact with no extra row',
          actual: await block.locator('.sky-prow').count(),
          expected: 1,
        })
        await page.evaluate(() => {
          const fixture = (window as unknown as DictationWindow).entryAudio
          fixture.deny = false
          fixture.defer = true
        })
        await mic.click()
        await form.getByRole('button', { name: 'Cancel dictation' }).waitFor()
        await form.getByRole('button', { name: 'Cancel', exact: true }).click()
        await block.getByRole('button', { name: 'Add entry', exact: true }).click()
        await editor.fill('A new draft')
        await page.evaluate(() => (window as unknown as DictationWindow).entryAudio.grant!())
        await page.waitForFunction(() => {
          const tracks = (window as unknown as DictationWindow).entryAudio.tracks
          return tracks.length === 3 && tracks[2]!.readyState === 'ended'
        })
        assert({
          given: 'microphone permission is granted after the composer has been closed and reopened',
          should: 'release the late track and preserve the new draft',
          actual: [await editor.inputValue(), await page.title()],
          expected: ['A new draft', `sky · ${DAY.ymd} · Add entry`],
        })
        await page.goto(origin + '/2026-01-28?view=record')
        const nextDayTitle = () =>
          page.waitForFunction(() => document.title.includes('28') && document.title.endsWith('Day record'))
        await nextDayTitle()
        await page.goBack()
        await page.waitForFunction((title) => document.title === title, dayTitle)
        await page.goForward()
        await nextDayTitle()
      },
    )
  },
)

test(
  { name: 'to-do and reminder dictation use their own editable drafts and save actions', timeout: 45_000 },
  async (t) => {
    await runWysiwygE2e(
      t,
      { initialMarkdown: EMPTY, tempPrefix: 'sky-plan-dictation-', file: 'time/' + dayFile(DAY), day: true },
      async ({ page, origin, file, errors }) => {
        await page.setViewportSize({ width: 390, height: 844 })
        await connectPeers(page)
        await page.goto(`${origin}/${DAY.ymd}?view=record`)
        for (const [name, words] of [
          ['to-do', 'Review the draft'],
          ['reminder', 'bring the notes'],
        ] as const) {
          const quick = page.getByRole('button', { name: 'Dictate ' + name, exact: true })
          await quick.waitFor()
          const form = page.getByRole('form', { name: 'Add a ' + name, exact: true })
          const editor = form.getByRole('textbox', { name: 'Item text' })
          const add = form.getByRole('button', { name: 'Add ' + name, exact: true })
          if (name === 'to-do') await quick.click()
          else {
            await page.getByRole('button', { name: 'Add a reminder', exact: true }).click()
            await editor.fill('Remember to')
            await form.getByRole('button', { name: 'Continue dictating reminder' }).click()
          }
          await form.getByRole('button', { name: 'Stop dictation' }).waitFor()
          assert({
            given: `a live ${name} draft`,
            should: 'identify the field and wait for explicit submission',
            actual: [await page.title(), await add.isDisabled(), (await readFile(file, 'utf8')).includes(words)],
            expected: [`sky · ${DAY.ymd} · Dictating ${name}`, true, false],
          })
          await finishSpeech(page, form, words)
          const reviewed = name === 'to-do' ? words : 'Remember to ' + words
          assert({
            given: 'stopping the ' + name,
            should: 'retain the full text for editing',
            actual: await editor.inputValue(),
            expected: reviewed,
          })
          await editor.fill(reviewed + ' tomorrow')
          if (name === 'to-do') {
            await form.getByRole('button', { name: 'Add a time' }).click()
            await form.getByRole('textbox', { name: 'To-do time' }).fill('09:45')
          }
          await add.click()
          await form.waitFor({ state: 'hidden' })
        }
        const saved = await readFile(file, 'utf8')
        assert({
          given: 'reviewed speech saved through each planning form',
          should: 'write the timed to-do and reminder in their usual lists',
          actual: [
            saved.includes('Professional Commitments'),
            saved.includes('09:45 > Review the draft tomorrow'),
            saved.includes('## Reminders'),
            saved.includes('- Remember to bring the notes tomorrow'),
            errors,
          ],
          expected: [true, true, true, true, []],
        })
        await page.getByRole('button', { name: 'Dictate reminder', exact: true }).click()
        const reminder = page.getByRole('form', { name: 'Add a reminder' })
        await reminder.getByRole('button', { name: 'Stop dictation' }).waitFor()
        const commits = await page.evaluate(() => {
          const fixture = (window as unknown as DictationWindow).entryAudio
          fixture.defer = true
          return fixture.commits
        })
        await page.getByRole('button', { name: 'Dictate most important task', exact: true }).click()
        const dialog = page.getByRole('dialog', { name: 'Most important' })
        await dialog.getByRole('button', { name: 'Cancel dictation' }).waitFor()
        await page.waitForFunction(
          (previous) => (window as unknown as DictationWindow).entryAudio.commits > previous,
          commits,
        )
        const previousTrack = await page.evaluate(
          () => (window as unknown as DictationWindow).entryAudio.tracks.at(-1)!.readyState,
        )
        await sendEvent(page, { type: 'input_audio_buffer.committed', item_id: 'last' })
        await sendEvent(page, {
          type: 'conversation.item.input_audio_transcription.completed',
          item_id: 'last',
          transcript: 'Check the notes.',
        })
        await dialog.getByRole('button', { name: 'Close', exact: true }).click()
        await page.evaluate(() => (window as unknown as DictationWindow).entryAudio.grant!())
        const draft = reminder.getByRole('textbox', { name: 'Item text' })
        await draft.waitFor()
        assert({
          given: 'starting Most Important dictation while a reminder is listening',
          should: 'release the old mic and put its late final transcript in the original unsaved reminder',
          actual: [previousTrack, await draft.inputValue(), await readFile(file, 'utf8')],
          expected: ['ended', 'Check the notes.', saved],
        })
      },
    )
  },
)

test(
  { name: 'Most Important dictation follows the writing, interview and review workflow on a phone', timeout: 60_000 },
  async (t) => {
    const drafts: MIDraftInput[] = []
    const directions: string[] = []
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: EMPTY,
        tempPrefix: 'sky-mi-dictation-',
        file: 'time/' + dayFile(DAY),
        day: true,
        mostImportant: {
          suggest: async (_day, options) => {
            directions.push(options?.feedback ?? '')
            return {
              contextSummary: '',
              suggestions: [{ summary: 'Plan the Atlas review', reason: 'Prepare the next draft.' }],
            }
          },
          question: async (_day, input) => (input.answers.length ? null : 'Who will review the draft?'),
          draft: async (_day, input) => {
            drafts.push(input)
            return {
              summary: input.previous?.summary ?? input.statement,
              dueBy: '',
              body: input.previous?.body ?? 'Prepare the draft for review.',
            }
          },
        },
      },
      async ({ page, origin, file, errors }) => {
        await page.setViewportSize({ width: 390, height: 844 })
        await connectPeers(page)
        await page.goto(`${origin}/${DAY.ymd}?view=record`)
        const launch = page.getByRole('button', { name: 'Dictate most important task', exact: true })
        await launch.waitFor()
        const originalTitle = await page.title()
        await launch.click()
        const dialog = page.getByRole('dialog', { name: 'Most important' })
        const next = dialog.getByRole('button', { name: 'Continue', exact: true })
        await dialog.getByRole('button', { name: 'Stop dictation' }).waitFor()
        await page.emulateMedia({ reducedMotion: 'reduce' })
        assert({
          given: 'the mic on the Most Important card',
          should: 'open the writing field directly with the same listening cue and hold Continue',
          actual: [
            directions.length,
            await next.isDisabled(),
            await dialog.locator('.sky-entry-wave').evaluate((w) => getComputedStyle(w).animationName),
            await page.title(),
          ],
          expected: [
            0,
            true,
            'sky-entry-listening-fade',
            `sky · ${DAY.ymd} · Most important · Dictating most important task`,
          ],
        })
        await finishSpeech(page, dialog, 'Review the Atlas draft')
        const task = dialog.getByRole('textbox', { name: 'Your most important task' })
        await task.waitFor()
        await task.fill('Review the Atlas proposal')
        await next.click()
        const answer = dialog.getByRole('textbox', { name: 'Answer Sky' })
        await answer.waitFor()
        await dialog.getByRole('button', { name: 'Dictate answer', exact: true }).click()
        await dialog.getByRole('button', { name: 'Stop dictation' }).waitFor()
        await sendEvent(page, {
          type: 'conversation.item.input_audio_transcription.delta',
          item_id: 'pause',
          delta: 'Jane',
        })
        await dialog.getByRole('group', { name: 'Live answer text' }).getByText('Jane').waitFor()
        await dialog.getByRole('button', { name: 'Close', exact: true }).click()
        await dialog.waitFor({ state: 'hidden' })
        await page.getByRole('button', { name: 'Continue draft', exact: true }).click()
        assert({
          given: 'closing the interview mid-dictation',
          should: 'keep the received words and release the microphone',
          actual: [
            await answer.inputValue(),
            await page.evaluate(() => (window as unknown as DictationWindow).entryAudio.tracks.at(-1)!.readyState),
          ],
          expected: ['Jane', 'ended'],
        })
        await dialog.getByRole('button', { name: 'Continue dictating answer', exact: true }).click()
        await finishSpeech(page, dialog, 'will review it.')
        await next.click()
        const title = dialog.getByRole('textbox', { name: 'Most important', exact: true })
        await title.waitFor()
        await dialog.getByRole('button', { name: 'Continue dictating task title' }).click()
        await finishSpeech(page, dialog, 'with Jane')
        await dialog.getByRole('button', { name: 'Refine with Sky', exact: true }).click()
        await dialog.getByRole('button', { name: 'Dictate refinement' }).click()
        await finishSpeech(page, dialog, 'Keep the scope narrow.')
        await dialog.getByRole('button', { name: 'Refine draft', exact: true }).click()
        await dialog.getByRole('textbox', { name: 'Refine with Sky' }).waitFor({ state: 'hidden' })
        assert({
          given: 'dictated and edited task, answer, title and refinement',
          should: 'pass the reviewed words to the correct workflow steps before any notebook save',
          actual: [
            drafts[0]?.statement,
            drafts[0]?.answers[0]?.answer,
            drafts[1]?.feedback,
            await title.inputValue(),
            await readFile(file, 'utf8'),
          ],
          expected: [
            'Review the Atlas proposal',
            'Jane will review it.',
            'Keep the scope narrow.',
            'Review the Atlas proposal with Jane',
            EMPTY,
          ],
        })
        await dialog.getByRole('button', { name: 'Add to day', exact: true }).click()
        await dialog.waitFor({ state: 'hidden' })
        assert({
          given: 'accepting the Most Important draft',
          should: 'write the task and restore the day title',
          actual: [(await readFile(file, 'utf8')).includes('Review the Atlas proposal with Jane'), await page.title()],
          expected: [true, originalTitle],
        })
        await page.getByRole('button', { name: 'Add another', exact: true }).click()
        await dialog.getByText('Give Sky some direction', { exact: true }).click()
        const directionMic = dialog.getByRole('button', { name: 'Dictate suggestion direction' })
        await directionMic.click()
        await finishSpeech(page, dialog, 'Focus on Atlas.')
        await Promise.all([
          page.waitForResponse((r) => r.url().endsWith('/mi/suggest')),
          dialog.getByRole('button', { name: 'Rethink suggestions' }).click(),
        ])
        assert({
          given: 'dictation in the suggestion prompt',
          should: 'send its text when Rethink is chosen',
          actual: [directions.at(-1), errors],
          expected: ['Focus on Atlas.', []],
        })
      },
    )
  },
)
