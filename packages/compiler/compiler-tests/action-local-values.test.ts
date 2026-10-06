import { AST, Langium } from '@parser'
import { Assert, Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { Compile } from '../compiler-src/codegen/react-native/Compile'
import { TestCompiler as Compiler } from './test-compile'

Describe('compiler: sequential action-local values', () => {
  Test('captures the value at its statement before a subsequent write', async () => {
    const compiled = await Compiler.compileCode(`
      view Main {
        state Count = 1
        action Capture() {
          let Reading = Count
          set Count = 2
          return Reading
        }
        render "Capture"
      }
      app Sample { id "action.values" name "Values" version "1.0.0" view Main }
    `)
    const action = AST.streamAllContents(compiled.validation.entry.ast).find(AST.isActionDeclaration)
    Assert.defined(action, 'the source declares a capture action')
    const code = Langium.toString(Compile.ActionDeclaration(action))
    const { default: TR } = await import(Repo.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts'))
    const scope: Record<string, any> = { Count: TR.Cell(TR.Value(1)) }
    const source = new Bun.Transpiler({ loader: 'ts' }).transformSync(code)
    new Function('TR', '_Scope', '_TaoActionOwner', source)(TR, scope, undefined)
    const result = await TR.DoResult(scope['Capture'])
    Expect(result.getJSValue()).toBe(1)
    Expect(scope['Count'].getJSValue()).toBe(2)
  })
})
