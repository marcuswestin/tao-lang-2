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
})
