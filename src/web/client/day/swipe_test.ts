import { assert, test } from '#test'
import { REVEAL_PX, revealOpacity, settleSwipe } from './swipe.ts'

test({ name: 'swipe - a short pull opens, a shorter one closes, a long one deletes' }, () => {
  assert({
    given: 'pulls of a quarter, half, and two-thirds of a phone-wide row',
    should: 'close, open, and delete in turn',
    actual: [settleSwipe(-30, 320), settleSwipe(-REVEAL_PX / 2, 320), settleSwipe(-215, 320)],
    expected: ['closed', 'open', 'delete'],
  })
})

test({ name: 'swipe - the delete threshold follows the row but never runs away on a wide one' }, () => {
  assert({
    given: 'the same 240px pull on a phone row and on a tablet row',
    should: 'delete on both — the threshold caps at 240 however wide the row',
    actual: [settleSwipe(-240, 320), settleSwipe(-240, 900), settleSwipe(-200, 900)],
    expected: ['delete', 'delete', 'open'],
  })
})

test({ name: 'swipe - the Delete word fades in once the pane has room for it' }, () => {
  assert({
    given: 'the row at rest, half revealed, and fully revealed',
    should: 'show nothing, nothing yet, and the word plainly',
    actual: [revealOpacity(0), revealOpacity(-REVEAL_PX / 2), revealOpacity(-REVEAL_PX)],
    expected: [0, 0, 1],
  })
})
