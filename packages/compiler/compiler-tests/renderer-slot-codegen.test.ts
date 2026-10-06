import { Langium } from '@parser'
import { FS, Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import {
  emitSlotDescriptor,
  emitSlotPlacement,
} from '../compiler-src/codegen/react-native/app/renderer-slot-codegen'
import { gen } from '../compiler-src/codegen/react-native/codegen-util'

type Descriptor = { body: () => void; environment: object }
type Placement = {
  frame: object
  props: { renderer: Descriptor | null; args: object; taoProps: object; key?: string }
}

Describe('compiler: renderer slot expressions', () => {
  Test(
    'passes stable bodies and fresh environments through the real runtime renderer boundary without mounting',
    async () => {
      const { createSlotRenderer, RenderSlotFrame } = await import(
        FS.resolvePath('packages/apps/runtime/TaoRuntime-src/TR-render-slots.tsx', Repo.getRoot())
      )
      let bodyCalls = 0
      const body = () => {
        bodyCalls++
        return null
      }
      const code = Langium.toString(emitSlotDescriptor({
        createRenderer: gen`createRenderer`,
        body: gen`body`,
        environment: gen`environment`,
      }))
      const evaluate = new Function('createRenderer', 'body', 'environment', `return ${code};`)
      const firstEnvironment = { value: 'first' }
      const secondEnvironment = { value: 'second' }
      const first = evaluate(createSlotRenderer, body, firstEnvironment)
      const second = evaluate(createSlotRenderer, body, secondEnvironment)
      const args = {}
      type BodyElement = { type: typeof body; props: { args: object; environment: object } }
      const firstElement = RenderSlotFrame({ renderer: first, args }) as BodyElement
      const secondElement = RenderSlotFrame({ renderer: second, args }) as BodyElement
      Expect(first).not.toBe(second)
      Expect(firstElement.type).toBe(body)
      Expect(secondElement.type).toBe(body)
      Expect(firstElement.props.environment).toBe(firstEnvironment)
      Expect(secondElement.props.environment).toBe(secondEnvironment)
      Expect(firstElement.props.args).toBe(args)
      Expect(secondElement.props.args).toBe(args)
      Expect(RenderSlotFrame({ renderer: null, args })).toBeNull()
      Expect(bodyCalls).toBe(0)
    },
  )

  Test(
    'creates fresh descriptors with one stable body and the current enclosing environment without calling the body',
    () => {
      let bodyCalls = 0
      let environmentCalls = 0
      let descriptorCalls = 0
      const body = () => {
        bodyCalls++
      }
      let currentEnvironment = { value: 'first' }
      const environment = () => {
        environmentCalls++
        return currentEnvironment
      }
      const createRenderer = (component: () => void, captured: object): Descriptor => {
        descriptorCalls++
        return { body: component, environment: captured }
      }
      const code = Langium.toString(emitSlotDescriptor({
        createRenderer: gen`createRenderer`,
        body: gen`body`,
        environment: gen`environment()`,
      }))
      const evaluate = new Function('createRenderer', 'body', 'environment', `return ${code};`)
      const first = evaluate(createRenderer, body, environment) as Descriptor
      const firstEnvironment = currentEnvironment
      currentEnvironment = { value: 'second' }
      const second = evaluate(createRenderer, body, environment) as Descriptor
      Expect(first).not.toBe(second)
      Expect(first.body).toBe(body)
      Expect(second.body).toBe(body)
      Expect(first.environment).toBe(firstEnvironment)
      Expect(second.environment).toBe(currentEnvironment)
      Expect({ bodyCalls, environmentCalls, descriptorCalls }).toEqual({
        bodyCalls: 0,
        environmentCalls: 2,
        descriptorCalls: 2,
      })
    },
  )

  Test('evaluates selection and placement props once and projects arguments only for filled slots', () => {
    const calls: string[] = []
    let bodyCalls = 0
    const body = () => {
      bodyCalls++
    }
    const renderer: Descriptor = { body, environment: { value: 'captured' } }
    const binding = { renderer, argument: { value: 'projected' } }
    let selected: typeof binding | null = binding
    const taoProps = { tag: 'placement', designSpec: {} }
    const emptyArguments = { value: 'empty' }
    const frame = {}
    const scope = {
      select: () => {
        calls.push('selection')
        return selected
      },
      props: () => {
        calls.push('props')
        return taoProps
      },
      renderer: (value: typeof binding) => {
        calls.push('renderer')
        return value.renderer
      },
      project: (value: typeof binding) => {
        calls.push('arguments')
        return value.argument
      },
      empty: () => {
        calls.push('empty arguments')
        return emptyArguments
      },
      key: () => {
        calls.push('key')
        return 'placement-key'
      },
      createElement: (component: object, props: Placement['props']): Placement => {
        calls.push('frame')
        return { frame: component, props }
      },
      frame,
    }
    const code = Langium.toString(emitSlotPlacement({
      createElement: gen`scope.createElement`,
      frameComponent: gen`scope.frame`,
      selection: gen`scope.select()`,
      selectedLocal: 'selected',
      rendererForSelected: gen`scope.renderer(selected)`,
      argumentsForSelected: gen`scope.project(selected)`,
      emptyArguments: gen`scope.empty()`,
      taoProps: gen`scope.props()`,
      taoPropsLocal: 'placementProps',
      key: gen`scope.key()`,
    }))
    const evaluate = new Function('scope', `return ${code};`)
    const filled = evaluate(scope) as Placement
    Expect(calls).toEqual(['selection', 'props', 'renderer', 'arguments', 'key', 'frame'])
    Expect(filled.frame).toBe(frame)
    Expect(filled.props.renderer).toBe(renderer)
    Expect(filled.props.args).toBe(binding.argument)
    Expect(filled.props.taoProps).toBe(taoProps)
    Expect(filled.props.key).toBe('placement-key')
    calls.length = 0
    selected = null
    const empty = evaluate(scope) as Placement
    Expect(calls).toEqual(['selection', 'props', 'empty arguments', 'key', 'frame'])
    Expect(empty.frame).toBe(filled.frame)
    Expect(empty.props.key).toBe(filled.props.key)
    Expect(empty.props.renderer).toBeNull()
    Expect(empty.props.args).toBe(emptyArguments)
    Expect(empty.props.taoProps).toBe(taoProps)
    Expect(bodyCalls).toBe(0)
    calls.length = 0
    selected = binding
    Expect((evaluate(scope) as Placement).props.renderer).toBe(renderer)
    Expect(calls).toEqual(['selection', 'props', 'renderer', 'arguments', 'key', 'frame'])
  })

  Test('keeps separate placement plans independent and leaves an unsupplied key absent', () => {
    const placement = (selectedLocal: string, taoPropsLocal: string, label: string) =>
      emitSlotPlacement({
        createElement: gen`createElement`,
        frameComponent: gen`frame`,
        selection: gen`null`,
        selectedLocal,
        rendererForSelected: gen`${selectedLocal}.renderer`,
        argumentsForSelected: gen`${selectedLocal}.args`,
        emptyArguments: gen`({})`,
        taoProps: gen`({ tag: ${gen.jsLiteral(label)} })`,
        taoPropsLocal,
      })
    const earlier = placement('firstSelected', 'firstProps', 'first')
    const later = placement('secondSelected', 'secondProps', 'second')
    const frame = {}
    const createElement = (component: object, props: Placement['props']): Placement => ({ frame: component, props })
    const execute = (expression: ReturnType<typeof emitSlotPlacement>) =>
      new Function('createElement', 'frame', `return ${Langium.toString(expression)};`)(
        createElement,
        frame,
      ) as Placement
    const second = execute(later)
    const first = execute(earlier)
    Expect(first.frame).toBe(frame)
    Expect(second.frame).toBe(frame)
    Expect(first.props.taoProps).toEqual({ tag: 'first' })
    Expect(second.props.taoProps).toEqual({ tag: 'second' })
    Expect(Object.hasOwn(first.props, 'key')).toBe(false)
    Expect(Object.hasOwn(second.props, 'key')).toBe(false)
    Expect(first.props.args).not.toBe(second.props.args)
  })

  Test('groups caller-compiled comma expressions at each callee and argument boundary', () => {
    const body = () => {}
    const environment = {}
    const ignored = {}
    const createRenderer = (component: () => void, captured: object): Descriptor => ({
      body: component,
      environment: captured,
    })
    const descriptorCode = Langium.toString(emitSlotDescriptor({
      createRenderer: gen`ignored, createRenderer`,
      body: gen`ignored, body`,
      environment: gen`ignored, environment`,
    }))
    const renderer = new Function('ignored', 'createRenderer', 'body', 'environment', `return ${descriptorCode};`)(
      ignored,
      createRenderer,
      body,
      environment,
    ) as Descriptor
    Expect(renderer.body).toBe(body)
    Expect(renderer.environment).toBe(environment)
    const frame = {}
    const taoProps = {}
    const args = {}
    const emptyArgs = {}
    const binding = { renderer, args }
    const createElement = (component: object, props: Placement['props']): Placement => ({ frame: component, props })
    const placementCode = Langium.toString(emitSlotPlacement({
      createElement: gen`scope.ignored, scope.createElement`,
      frameComponent: gen`scope.ignored, scope.frame`,
      selection: gen`scope.ignored, scope.binding`,
      selectedLocal: 'chosen',
      rendererForSelected: gen`scope.ignored, chosen.renderer`,
      argumentsForSelected: gen`scope.ignored, chosen.args`,
      emptyArguments: gen`scope.ignored, scope.emptyArgs`,
      taoProps: gen`scope.ignored, scope.taoProps`,
      taoPropsLocal: 'props',
      key: gen`scope.ignored, "key"`,
    }))
    const evaluate = new Function('scope', `return ${placementCode};`)
    const scope = { ignored, createElement, frame, binding, emptyArgs, taoProps }
    const filled = evaluate(scope) as Placement
    const empty = evaluate({ ...scope, binding: null }) as Placement
    Expect(filled.frame).toBe(frame)
    Expect(filled.props.renderer).toBe(renderer)
    Expect(filled.props.args).toBe(args)
    Expect(filled.props.taoProps).toBe(taoProps)
    Expect(filled.props.key).toBe('key')
    Expect(empty.frame).toBe(frame)
    Expect(empty.props.renderer).toBeNull()
    Expect(empty.props.args).toBe(emptyArgs)
    Expect(empty.props.taoProps).toBe(taoProps)
    Expect(empty.props.key).toBe('key')
  })

  Test('rejects equal local names before emitting a placement', () => {
    Expect(() =>
      emitSlotPlacement({
        createElement: gen`createElement`,
        frameComponent: gen`frame`,
        selection: gen`null`,
        selectedLocal: 'same',
        rendererForSelected: gen`renderer`,
        argumentsForSelected: gen`args`,
        emptyArguments: gen`({})`,
        taoProps: gen`props`,
        taoPropsLocal: 'same',
      })
    ).toThrow('slot placement locals have distinct names')
  })
})
