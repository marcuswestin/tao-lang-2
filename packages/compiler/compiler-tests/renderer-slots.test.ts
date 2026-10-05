import { AST, Langium, Parser } from '@parser'
import { Describe, Expect, stubContainer, stubView, Test } from '@shared/test'
import { Compile } from '../compiler-src/codegen/react-native/Compile'
import { TestCompiler as Compiler } from './test-compile'

const source = `
  ${stubContainer('Stack')}
  ${stubView('Text', 'Value text')}
  view Default(Value text, Caption text default "view caption") {
    render Text("{ Value }: { Caption }")
  }
  view Replacement(Value text, Caption text default "replacement caption") {
    render Text("Replacement { Value }: { Caption }")
  }
  view Owner(Value text) {
    @item(Value text, Caption text default "slot caption"): Default
    render Stack {
      @item(Value: Value)
      @item(Caption: "second", Value: Value)
    }
  }
  view Main { render Owner("current") { @item: Replacement } }
  app Slots { id "compiledslots" version "1.0.0" name "Slots" view Main }
`

Describe('compiler: production renderer slots', () => {
  Test('compiles actual typed defaults, named fills and repeated placements with stable module bodies', async () => {
    const result = await Compiler.compileCode(source)
    const code = result.code
    const bodies = [...code.matchAll(/function (_TaoSlotBody\d+)\(/g)].map(match => match[1])
    Expect(bodies).toHaveLength(2)
    Expect(new Set(bodies).size).toBe(2)
    Expect(code.indexOf('function _TaoSlotBody')).toBeLessThan(code.indexOf('_Scope.Owner = function'))
    Expect(code).toContain('TR.RenderSlots.create')
    Expect(code).toContain('TR.RenderSlots.select')
    Expect(code).toContain('TR.RenderSlots.Frame')
    Expect(code).toContain('slot caption')
    Expect(code).not.toContain('Readonly<Record<string, React.ReactNode>>')
    Expect(code).toContain('TR.SlotRenderer')
    Expect(code).toContain('Replacement')
  })

  Test('starts each actual source compilation with a fresh component allocation plan', async () => {
    const first = await Compiler.compileCode(source)
    const second = await Compiler.compileCode(source.replace('"current"', '"changed"'))
    const names = (code: string) => [...code.matchAll(/function (_TaoSlotBody\d+)\(/g)].map(match => match[1])
    Expect(names(first.code)).toEqual(names(second.code))
    Expect(first.code).toContain('current')
    Expect(second.code).toContain('changed')
  })

  Test('compiles placement metadata from its actual source coordinates and current ambient context', async () => {
    const parsed = await Parser.parseCode(
      `
      view Host { render "host" }
      view Owner {
        @item: empty
        render Host {
          #placement accessible label "Slot occurrence"
          @item
        }
      }
    `,
      { validation: false },
    )
    const placement = AST.streamAllContents(parsed.entry.ast).find(node =>
      AST.isRenderSlotUse(node) && !AST.isRenderSlotFill(node)
    )
    Expect.Is(placement, AST.isRenderSlotUse)
    Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])
    const code = Langium.toString(Compile.RenderSlotTaoProps(placement, {
      journeyObservations: true,
      projectRoot: '/__tao__',
      studio: true,
    }))
    Expect(code).toContain('TR.ViewTaoProps')
    Expect(code).toContain('testTag: "placement"')
    Expect(code).toContain('Slot occurrence')
    Expect(code).toContain(`start: ${placement.$cstNode!.offset}`)
    Expect(code).toContain(`end: ${placement.$cstNode!.end}`)
    Expect(code).toContain('_ViewProps.__tao, false')
    Expect(code).toContain('sourceVersion: "text-v1:')
  })
})
