import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'

Describe('TR adaptive layout', () => {
  Test('replaces a concrete width with a later width maximum', () => {
    const merged = TR.Layout.merge(
      TR.Layout.create([['width', 960]]),
      TR.Layout.create([['width', 'max', 720]]),
    )

    Expect(merged?.entries).toEqual([['width', 'max', 720]])
    Expect(TR.Layout.resolve({ entries: merged?.entries ?? [] })).toEqual({ maxWidth: 720, width: '100%' })
  })

  Test('replaces repeated direct dimensions before lowering their distinct native effects', () => {
    const layout = TR.Layout.create([
      ['width', 'fill'],
      ['width', 960],
      ['width', 'max', 720],
    ])

    Expect(layout.entries).toEqual([['width', 'max', 720]])
    Expect(TR.Layout.resolve({ entries: layout.entries, parentDirection: 'row' })).toEqual({
      maxWidth: 720,
    })
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

  Test('caps row claims without turning each sibling into a full-row width', () => {
    const layout = TR.Layout.create([['claim', 2], ['width', 'max', 720]])

    Expect(TR.Layout.resolve({ entries: layout.entries, parentDirection: 'row' })).toEqual({
      flexGrow: 2,
      maxWidth: 720,
    })
  })

  Test('keeps a centered column fluid across its parent cross axis up to the maximum', () => {
    const layout = TR.Layout.create([['width', 'max', 720], ['centered']])

    Expect(TR.Layout.resolve({ entries: layout.entries, parentDirection: 'column' })).toEqual({
      alignSelf: 'center',
      maxWidth: 720,
      width: '100%',
    })
  })

  Test('clears one spacing side with `none` whichever side the clause names first', () => {
    const clearedLast = TR.Layout.create([['pad', 'vertical', 4, 'horizontal', 'none']])
    const clearedFirst = TR.Layout.create([['pad', 'horizontal', 'none', 'vertical', 4]])
    const expected = { paddingBottom: 4, paddingTop: 4 }

    Expect(TR.Layout.resolve({ entries: clearedLast.entries })).toEqual(expected)
    Expect(TR.Layout.resolve({ entries: clearedFirst.entries })).toEqual(expected)
  })

  Test('carries a cleared slot through a later merge so a weaker layer cannot set it again', () => {
    const merged = TR.Layout.merge(
      TR.Layout.create([['pad', 12], ['gap', 8]]),
      TR.Layout.create([['pad', 'left', 'none'], ['gap', 'none']]),
    )

    Expect(TR.Layout.resolve({ entries: merged?.entries ?? [] })).toEqual({
      paddingBottom: 12,
      paddingRight: 12,
      paddingTop: 12,
    })
    // The clear stays in the list, because the layer it has to overrule may still be merged in.
    Expect(TR.Layout.merge(TR.Layout.create([['gap', 4]]), merged)?.entries).toContainEqual(['gap', 'none'])
    Expect(TR.Layout.resolve({
      entries: TR.Layout.merge(TR.Layout.create([['gap', 4]]), merged)?.entries ?? [],
    })).toEqual({
      paddingBottom: 12,
      paddingRight: 12,
      paddingTop: 12,
    })
  })

  Test('sets a slot again after a clear, by side and whole', () => {
    const layout = TR.Layout.create([
      ['pad', 12],
      ['pad', 'none'],
      ['pad', 'left', 4],
      ['gap', 'none'],
      ['gap', 6],
    ])

    Expect(TR.Layout.resolve({ entries: layout.entries })).toEqual({ gap: 6, paddingLeft: 4 })
  })

  Test('refuses `none` after a clause head that names no slot to clear', () => {
    Expect(() => TR.Layout.create([['content', 'none'] as never])).toThrow(
      "Layout clause 'content none' cannot clear a slot with 'none'.",
    )
  })
})
