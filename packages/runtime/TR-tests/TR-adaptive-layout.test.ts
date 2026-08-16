import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'

Describe('TR adaptive layout', () => {
  Test('lowers width max to React Native maxWidth', () => {
    Expect(TR.Layout.resolve({ entries: [['width', 'max', 720]] })).toEqual({ maxWidth: 720 })
  })

  Test('replaces a concrete width with a later width maximum', () => {
    const merged = TR.Layout.merge(
      TR.Layout.create([['width', 960]]),
      TR.Layout.create([['width', 'max', 720]]),
    )

    Expect(merged?.entries).toEqual([['width', 'max', 720]])
    Expect(TR.Layout.resolve({ entries: merged?.entries ?? [] })).toEqual({ maxWidth: 720 })
  })

  Test('replaces repeated direct dimensions before lowering their distinct native effects', () => {
    const layout = TR.Layout.create([
      ['width', 'fill'],
      ['width', 960],
      ['width', 'max', 720],
    ])

    Expect(layout.entries).toEqual([['width', 'max', 720]])
    Expect(TR.Layout.resolve({ entries: layout.entries, parentDirection: 'row' })).toEqual({ maxWidth: 720 })
  })

  Test('keeps a later overlay at the end of the semantic list', () => {
    const merged = TR.Layout.merge(
      TR.Layout.create([['width', 960], ['centered']]),
      TR.Layout.create([['width', 'fill']]),
    )

    Expect(merged?.entries).toEqual([['centered'], ['width', 'fill']])
    Expect(TR.Layout.resolve({ entries: merged?.entries ?? [], parentDirection: 'column' })).toEqual({
      alignSelf: 'stretch',
    })
  })

  Test('lets a later bare fill replace each of its decomposed earlier effects', () => {
    const layout = TR.Layout.create([
      ['claim', 2],
      ['centered'],
      ['width', 960],
      ['height', 480],
      ['fill'],
    ])

    Expect(layout.entries).toEqual([['fill']])
    Expect(TR.Layout.resolve({ entries: layout.entries })).toEqual({ alignSelf: 'stretch', flexGrow: 1 })
  })

  Test('lets a later physical dimension replace only the matching bare-fill axis', () => {
    const widthLayout = TR.Layout.create([['fill'], ['width', 960]])
    const heightLayout = TR.Layout.create([['fill'], ['height', 480]])

    Expect(widthLayout.entries).toEqual([['fill'], ['width', 960]])
    Expect(TR.Layout.resolve({ entries: widthLayout.entries, parentDirection: 'row' })).toEqual({
      alignSelf: 'stretch',
      width: 960,
    })
    Expect(TR.Layout.resolve({ entries: widthLayout.entries, parentDirection: 'column' })).toEqual({
      flexGrow: 1,
      width: 960,
    })
    Expect(TR.Layout.resolve({ entries: heightLayout.entries, parentDirection: 'row' })).toEqual({
      flexGrow: 1,
      height: 480,
    })
    Expect(TR.Layout.resolve({ entries: heightLayout.entries, parentDirection: 'column' })).toEqual({
      alignSelf: 'stretch',
      height: 480,
    })
  })

  Test('does not let physical dimensions erase later specialized fill overrides', () => {
    const layout = TR.Layout.create([
      ['fill'],
      ['claim', 2],
      ['centered'],
      ['width', 960],
      ['height', 480],
    ])

    Expect(TR.Layout.resolve({ entries: layout.entries, parentDirection: 'row' })).toEqual({
      alignSelf: 'center',
      flexGrow: 2,
      height: 480,
      width: 960,
    })
  })

  Test('composes a width maximum with bare fill in either source order', () => {
    const fillThenMaximum = TR.Layout.create([['fill'], ['width', 'max', 720]])
    const maximumThenFill = TR.Layout.create([['width', 'max', 720], ['fill']])
    const expected = { alignSelf: 'stretch', flexGrow: 1, maxWidth: 720 }

    Expect(TR.Layout.resolve({ entries: fillThenMaximum.entries, parentDirection: 'row' })).toEqual(expected)
    Expect(TR.Layout.resolve({ entries: maximumThenFill.entries, parentDirection: 'row' })).toEqual(expected)
  })
})
