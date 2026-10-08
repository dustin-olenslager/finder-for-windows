'use strict'

/**
 * Remembering the window's size and position.
 *
 * The bug this file is really about is not saving — it is restoring. A saved position is a
 * pair of coordinates on a display that may not exist any more, and a window restored onto
 * an unplugged monitor is off screen, which is indistinguishable from the app failing to
 * launch. That is the case worth pinning.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { isVisibleOn, normalizeSize } = require('../src/infrastructure/window-state')

const laptop = { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }
const second = { bounds: { x: 1920, y: 0, width: 2560, height: 1440 }, workArea: { x: 1920, y: 0, width: 2560, height: 1400 } }

test('a window on the only display is restored', () => {
  assert.equal(isVisibleOn({ x: 100, y: 80, width: 1180, height: 760 }, [laptop]), true)
})

test('a window on a second display is restored while that display exists', () => {
  assert.equal(isVisibleOn({ x: 2200, y: 100, width: 1180, height: 760 }, [laptop, second]), true)
})

test('a window saved on a monitor that is now gone is NOT restored', () => {
  // The case that matters: unplug the second monitor and the window would open at x=2200,
  // which is off screen. Refusing the position is what keeps the app openable.
  assert.equal(isVisibleOn({ x: 2200, y: 100, width: 1180, height: 760 }, [laptop]), false)
})

test('a window mostly off the edge is refused', () => {
  // Only a sliver on screen: the title bar cannot be grabbed, so it cannot be moved back.
  assert.equal(isVisibleOn({ x: 1900, y: 100, width: 1180, height: 760 }, [laptop]), false)
})

test('a window hanging off the right edge is still restored', () => {
  // Deliberately not "fully inside": pushing a window half off the edge is a normal way to
  // arrange a screen, and refusing to restore it would be its own annoyance.
  assert.equal(isVisibleOn({ x: 1400, y: 100, width: 1180, height: 760 }, [laptop]), true)
})

test('a negative position at the top-left is allowed', () => {
  assert.equal(isVisibleOn({ x: -40, y: -10, width: 1180, height: 760 }, [laptop]), true)
})

test('rubbish is refused rather than trusted', () => {
  assert.equal(isVisibleOn(null, [laptop]), false)
  assert.equal(isVisibleOn({ x: 0, y: 0, width: 1180, height: 760 }, []), false)
  assert.equal(isVisibleOn({ x: NaN, y: 0, width: 1180, height: 760 }, [laptop]), false)
  assert.equal(isVisibleOn({ x: 0, y: 0, width: 0, height: 760 }, [laptop]), false)
  assert.equal(isVisibleOn('nonsense', [laptop]), false)
})

test('a tiny saved size is clamped up to something usable', () => {
  const size = normalizeSize(
    { x: 10, y: 10, width: 20, height: 20 },
    { defaultWidth: 1180, defaultHeight: 760, minWidth: 720, minHeight: 460 }
  )
  assert.equal(size.width, 720, 'a 20px window would have to be fixed before it could be used')
  assert.equal(size.height, 460)
  assert.equal(size.x, 10, 'the position is left for the visibility check to judge')
})

test('an absurd saved size is clamped down', () => {
  const size = normalizeSize(
    { x: 0, y: 0, width: 99_999, height: 99_999 },
    { defaultWidth: 1180, defaultHeight: 760, minWidth: 720, minHeight: 460 }
  )
  assert.equal(size.width, 4720)
  assert.equal(size.height, 3040)
})
