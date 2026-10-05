import { AST, Langium } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { testParseSyntax } from '../../language/parser/parser-tests/test-parse'
import { emitSlotBodyHoists } from '../compiler-src/codegen/react-native/app/render-slot-hoists'
import { gen } from '../compiler-src/codegen/react-native/codegen-util'

async function definitionAnchors(): Promise<readonly [AST.Block, AST.Block]> {
  const parsed = await testParseSyntax('view First() {}\nview Second() {}')
  const [first, second] = parsed.entry.ast.statements
  Expect.Is(first, AST.isViewDeclaration)
  Expect.Is(second, AST.isViewDeclaration)
  Expect.Is(first.block, AST.isBlock)
  Expect.Is(second.block, AST.isBlock)
  return [first.block, second.block]
}

Describe('compiler: render slot body hoists', () => {
  Test('emits complete definitions in supplied order, without sorting by source position', async () => {
    const [first, second] = await definitionAnchors()
    const hoists = emitSlotBodyHoists([
      { sourceAnchor: second, bodyName: 'SecondBody', definition: gen`const SecondBody = defineBody("second");` },
      { sourceAnchor: first, bodyName: 'FirstBody', definition: gen`const FirstBody = defineBody("first");` },
    ])
    const order: string[] = []
    const defineBody = (name: string) => {
      order.push(name)
      return () => name
    }
    const bodies = new Function('defineBody', `${Langium.toString(hoists)}\nreturn [SecondBody, FirstBody];`)(
      defineBody,
    ) as Array<() => string>
    Expect(order).toEqual(['second', 'first'])
    Expect(bodies.map(body => body())).toEqual(['second', 'first'])
  })

  Test('emits nothing for an empty plan', () => {
    Expect(Langium.toString(emitSlotBodyHoists([]))).toBe('')
  })

  Test('rejects repeated definition sites independently of component names', async () => {
    const [first] = await definitionAnchors()
    Expect(() =>
      emitSlotBodyHoists([
        { sourceAnchor: first, bodyName: 'FirstBody', definition: gen`function FirstBody() {}` },
        { sourceAnchor: first, bodyName: 'OtherBody', definition: gen`function OtherBody() {}` },
      ])
    ).toThrow('slot body hoists have distinct source anchors')
  })

  Test('rejects repeated component names at distinct definition sites', async () => {
    const [first, second] = await definitionAnchors()
    Expect(() =>
      emitSlotBodyHoists([
        { sourceAnchor: first, bodyName: 'Body', definition: gen`function Body() {}` },
        { sourceAnchor: second, bodyName: 'Body', definition: gen`function Body() {}` },
      ])
    ).toThrow('slot body hoists have distinct component names')
  })

  Test('keeps overlapping file plans independent after successful and rejected emissions', async () => {
    const [first, second] = await definitionAnchors()
    const row = { sourceAnchor: first, bodyName: 'Body', definition: gen`function Body() { return "first"; }` }
    const earlier = emitSlotBodyHoists([row])
    Expect(() => emitSlotBodyHoists([row, row])).toThrow('slot body hoists have distinct source anchors')
    const later = emitSlotBodyHoists([
      { sourceAnchor: second, bodyName: 'Body', definition: gen`function Body() { return "second"; }` },
    ])
    const execute = (module: ReturnType<typeof emitSlotBodyHoists>) =>
      new Function(`${Langium.toString(module)}\nreturn Body();`)()
    Expect(execute(later)).toBe('second')
    Expect(execute(earlier)).toBe('first')
    Expect(execute(emitSlotBodyHoists([row]))).toBe('first')
  })
})
