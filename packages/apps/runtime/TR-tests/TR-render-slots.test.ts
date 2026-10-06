import TR from '@runtime/TR'
import type { RenderSlotBodyProps, TaoSlotRenderer } from '@runtime/TR-render-slots'
import type { TaoProps } from '@runtime/TR-TaoProps'
import { Assert } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { isValidElement, type ReactNode } from 'react'

const { create: createSlotRenderer, select: selectRenderSlot, Frame: RenderSlotFrame } = TR.RenderSlots

function bodyProps<Args, Environment>(node: ReactNode): RenderSlotBodyProps<Args, Environment> {
  Assert(isValidElement<RenderSlotBodyProps<Args, Environment>>(node), 'Expected a mounted slot body element.')
  return node.props
}

Describe('render slot descriptors', () => {
  Test('chooses defaults only for absent own supplies and returns supplied descriptors unchanged', () => {
    function Body(_props: RenderSlotBodyProps<{ value: string }, string>) {
      return null
    }
    const fallback = createSlotRenderer(Body, 'Default')
    const supplied = createSlotRenderer(Body, 'Supplied')
    Expect(selectRenderSlot(undefined, 'Header', fallback)).toBe(fallback)
    Expect(selectRenderSlot({}, 'Header', fallback)).toBe(fallback)
    Expect(selectRenderSlot({ Header: supplied }, 'Header', fallback)).toBe(supplied)
    Expect(selectRenderSlot({ Header: null }, 'Header', fallback)).toBeNull()
    Expect(selectRenderSlot({ Header: undefined }, 'Header', fallback)).toBeNull()
    Expect(selectRenderSlot({}, 'Header')).toBeNull()
    Expect(selectRenderSlot(undefined, 'Header', null)).toBeNull()
    const inherited = Object.create({ Header: supplied }) as Record<string, TaoSlotRenderer<{ value: string }>>
    Expect(selectRenderSlot(inherited, 'Header', fallback)).toBe(fallback)
    const own = Object.create(null) as Record<string, TaoSlotRenderer<{ value: string }>>
    own['Header'] = supplied
    Expect(selectRenderSlot(own, 'Header', fallback)).toBe(supplied)
  })

  Test('forwards a same-named lexical descriptor through wrappers without executing or recapturing it', () => {
    let calls = 0
    function Body(_props: RenderSlotBodyProps<{ value: string }, { owner: string }>) {
      calls += 1
      return null
    }
    const lexical = createSlotRenderer(Body, { owner: 'Outer' })
    const first = selectRenderSlot({ Header: lexical }, 'Header')
    const second = selectRenderSlot({ Header: first }, 'Header')
    const third = selectRenderSlot({ Header: second }, 'Header')
    Expect(first).toBe(lexical)
    Expect(second).toBe(lexical)
    Expect(third).toBe(lexical)
    Expect(calls).toBe(0)
    const props = bodyProps<{ value: string }, { owner: string }>(RenderSlotFrame({
      args: { value: 'Placement' },
      renderer: third,
    }))
    Expect(props.environment.owner).toBe('Outer')
    Expect(calls).toBe(0)
  })

  Test(
    'defers body execution and preserves argument wrappers, captures and occurrence props without evaluating them',
    () => {
      let reads = 0
      let bodies = 0
      const value = TR.Alias(() => {
        reads += 1
        return TR.Value('Live')
      })
      const args = { value }
      const environment = { captured: value }
      const taoProps: TaoProps = { accessibilityLabel: 'Placement label', testTag: 'placement' }
      function Body(_props: RenderSlotBodyProps<typeof args, typeof environment>) {
        bodies += 1
        return null
      }
      const renderer = createSlotRenderer(Body, environment)
      const first = RenderSlotFrame({ args, renderer, taoProps })
      const second = RenderSlotFrame({ args, renderer, taoProps })
      Expect(isValidElement(first)).toBe(true)
      Expect(isValidElement(second)).toBe(true)
      Expect(second).not.toBe(first)
      const props = bodyProps<typeof args, typeof environment>(first)
      Expect(props.args).toBe(args)
      Expect(props.args.value).toBe(value)
      Expect(props.environment).toBe(environment)
      Expect(props.environment.captured).toBe(value)
      Expect(props.taoProps).toBe(taoProps)
      Expect(reads).toBe(0)
      Expect(bodies).toBe(0)
    },
  )

  Test('passes current environments and arguments to fresh elements while retaining the body component type', () => {
    type Args = { value: string }
    type Environment = { caption: string }
    function Body(_props: RenderSlotBodyProps<Args, Environment>) {
      return null
    }
    const before = RenderSlotFrame({
      args: { value: 'Before' },
      renderer: createSlotRenderer(Body, { caption: 'Old' }),
    })
    const after = RenderSlotFrame({ args: { value: 'After' }, renderer: createSlotRenderer(Body, { caption: 'New' }) })
    Assert(isValidElement(before) && isValidElement(after), 'Expected slot body elements.')
    Expect(before.type).toBe(Body)
    Expect(after.type).toBe(Body)
    Expect(bodyProps<Args, Environment>(before).args.value).toBe('Before')
    Expect(bodyProps<Args, Environment>(after).args.value).toBe('After')
    Expect(bodyProps<Args, Environment>(after).environment.caption).toBe('New')
  })

  Test('suppresses an explicit empty placement without reading its arguments or calling the default body', () => {
    let calls = 0
    const argument = TR.Alias(() => {
      calls += 1
      return TR.Value('Argument')
    })
    function Body(_props: RenderSlotBodyProps<{ argument: typeof argument }, undefined>) {
      calls += 1
      return null
    }
    const fallback = createSlotRenderer(Body, undefined)
    const renderer = selectRenderSlot({ Header: null }, 'Header', fallback)
    Expect(RenderSlotFrame({ args: { argument }, renderer })).toBeNull()
    Expect(calls).toBe(0)
  })

  Test('preserves zero-argument and ordered multi-argument inputs without binding or unwrapping them', () => {
    function EmptyBody(_props: RenderSlotBodyProps<readonly [], undefined>) {
      return null
    }
    type Pair = readonly [TR.Value<string>, TR.Value<number>]
    function PairBody(_props: RenderSlotBodyProps<Pair, undefined>) {
      return null
    }
    const empty: readonly [] = []
    const title = TR.Value('Heading')
    const count = TR.Value(2)
    const pair: Pair = [title, count]
    const emptyProps = bodyProps<readonly [], undefined>(RenderSlotFrame({
      args: empty,
      renderer: createSlotRenderer(EmptyBody, undefined),
    }))
    const pairProps = bodyProps<Pair, undefined>(RenderSlotFrame({
      args: pair,
      renderer: createSlotRenderer(PairBody, undefined),
    }))
    Expect(emptyProps.args).toBe(empty)
    Expect(emptyProps.args).toHaveLength(0)
    Expect(pairProps.args).toBe(pair)
    Expect(pairProps.args[0]).toBe(title)
    Expect(pairProps.args[1]).toBe(count)
  })

  Test('hides differing captured types while typecheck rejects widening a renderer argument contract', () => {
    function TextBody(_props: RenderSlotBodyProps<{ value: string }, string>) {
      return null
    }
    function GeneralBody(_props: RenderSlotBodyProps<{ value: string | number }, number>) {
      return null
    }
    const textOnly = createSlotRenderer(TextBody, 'Text capture')
    const general = createSlotRenderer(GeneralBody, 12)
    const safelyNarrowed: TaoSlotRenderer<{ value: string }> = general
    // @ts-expect-error A body accepting only text cannot safely be invoked with numbers; the typecheck lane proves this.
    const unsafeWidening: TaoSlotRenderer<{ value: string | number }> = textOnly
    const supplied: Record<string, TaoSlotRenderer<{ value: string }>> = { Header: textOnly, Footer: safelyNarrowed }
    Expect(selectRenderSlot(supplied, 'Footer', textOnly)).toBe(general)
    Expect(unsafeWidening).toBe(textOnly)
  })
})
