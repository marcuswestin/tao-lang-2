import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'
import type { ComponentType } from 'react'

Describe('opaque associated rendered content', () => {
  Test('retains the selected component and receiver while taking metadata from its occurrence', () => {
    type Props = { __taoReceiver: TR.Value<string>; Caption: string; __tao?: TR.TaoProps }
    let mounts = 0
    const component: ComponentType<Props> = () => {
      mounts++
      return null
    }
    const receiver = TR.Value('First')
    const original = { __taoReceiver: receiver, Caption: 'bound', __tao: { testTag: 'old' } }
    const content = TR.RenderView(component, original)
    original.Caption = 'changed after creation'
    const occurrence = { testTag: 'new', accessibilityLabel: 'Occurrence' }
    const element = TR.MountRendered(content, { __tao: occurrence })
    Expect(mounts).toBe(0)
    Expect(element.type).toBe(component)
    Expect(element.props).toMatchObject({ __taoReceiver: receiver, Caption: 'bound', __tao: occurrence })
  })

  Test('reevaluates a live rendered value and rejects fabricated content', () => {
    const first = () => null
    const second = () => null
    let content = TR.RenderView(first, { Caption: 'first' })
    const live = TR.Alias(() => content)
    Expect(TR.MountRendered(live.evaluate()).type).toBe(first)
    content = TR.RenderView(second, { Caption: 'second' })
    Expect(TR.MountRendered(live.evaluate()).type).toBe(second)
    Expect(() => TR.MountRendered(TR.Value({} as TR.Rendered))).toThrow('content produced by a view')
  })
})
