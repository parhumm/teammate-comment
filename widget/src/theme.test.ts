import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lightnessOf } from './theme.ts'

/** Every form Chromium's getComputedStyle emits for `color`, as observed. */
test('text lightness decides the ramp: dark text wants light highlights', () => {
  const dark = (c: string) => assert.ok(lightnessOf(c)! < 0.5, `${c} is dark text`)
  const light = (c: string) => assert.ok(lightnessOf(c)! > 0.5, `${c} is light text`)

  dark('rgb(0, 0, 0)')
  dark('rgb(46, 59, 57)')
  dark('rgba(0, 0, 0, 0.87)')
  dark('oklch(0.24 0.01 75)')
  dark('lab(20 0 0)')
  dark('color(display-p3 0.1 0.1 0.1)')

  light('rgb(255, 255, 255)')
  light('rgba(240, 240, 240, 0.5)')
  light('oklch(0.95 0.005 80)')
  light('oklch(95% 0.005 80)')
  light('oklab(0.899994 0.000041011 0.0000180781)')
  light('lab(90 0 0)')
  light('color(srgb 0.9 0.9 0.9)')

  assert.equal(lightnessOf('rgb(0, 0, 0)'), 0)
  assert.ok(lightnessOf('rgb(255, 255, 255)')! > 0.999)
  assert.equal(lightnessOf('nonsense'), null)
  assert.equal(lightnessOf('hwb(0 0% 100%)'), null, 'never emitted as computed; not guessed')
})
