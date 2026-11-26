import { assert, test } from '#test'
import { keepScreenAwake, type ScreenAwakeHost } from './screenAwake.ts'

/** A browser that hands out screen locks and takes them back when the page is hidden, as a phone does. */
function phone(options: { refuses?: boolean } = {}) {
  let visible = true
  let changed: (() => void) | null = null
  const locks: Array<{ released: boolean; letGo: (() => void) | null }> = []
  const host: ScreenAwakeHost = {
    request: async () => {
      if (options.refuses) throw new Error('Low Power Mode')
      const lock = { released: false, letGo: null as (() => void) | null }
      locks.push(lock)
      return {
        release: async () => {
          lock.released = true
        },
        addEventListener: (_type, listener) => {
          lock.letGo = listener
        },
      }
    },
    visible: () => visible,
    onVisibilityChange: (listener) => {
      changed = listener
      return () => {
        changed = null
      }
    },
  }
  return {
    host,
    locks,
    listening: () => changed !== null,
    /** The page is hidden: the browser takes back any lock it gave. */
    hide() {
      visible = false
      for (const lock of locks) lock.letGo?.()
      changed?.()
    },
    show() {
      visible = true
      changed?.()
    },
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

test('a call keeps the screen on, takes the lock again when the page comes back, and lets go at the end', async () => {
  const device = phone()
  const stop = keepScreenAwake(device.host)
  await settle()
  const started = device.locks.length

  device.hide()
  await settle()
  const whileHidden = device.locks.length
  device.show()
  await settle()
  const afterReturn = device.locks.length

  stop()
  await settle()
  device.show()
  await settle()
  assert({
    given: 'a call that starts, a page hidden and shown again, then the end of the call',
    should: 'hold one lock, ask for none while hidden, take a new one on return, then release it and stop listening',
    actual: {
      started,
      whileHidden,
      afterReturn,
      afterEnd: device.locks.length,
      lastReleased: device.locks.at(-1)?.released,
      listening: device.listening(),
    },
    expected: { started: 1, whileHidden: 1, afterReturn: 2, afterEnd: 2, lastReleased: true, listening: false },
  })
})

test('a browser that refuses or lacks screen locks leaves the call alone', async () => {
  const refusing = phone({ refuses: true })
  const stopRefused = keepScreenAwake(refusing.host)
  await settle()
  stopRefused()

  const without = phone()
  delete without.host.request
  const stopWithout = keepScreenAwake(without.host)
  await settle()
  stopWithout()
  assert({
    given: 'a refusal, and a browser with no screen locks',
    should: 'hold nothing and throw nothing',
    actual: [refusing.locks.length, without.locks.length],
    expected: [0, 0],
  })
})

test('a call that ends while the lock is still being granted gives it straight back', async () => {
  const device = phone()
  const stop = keepScreenAwake(device.host)
  stop()
  await settle()
  assert({
    given: 'the end of the call before the browser answers',
    should: 'release the lock as soon as it arrives',
    actual: device.locks.map((lock) => lock.released),
    expected: [true],
  })
})
