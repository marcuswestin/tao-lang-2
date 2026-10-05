import { ASTUtils } from '@ast-utils'
import { AST, Langium } from '@parser'
import { Assert, FS, Repo } from '@shared'
import { Describe, Expect, stubView, Test } from '@shared/test'
import { Compile } from '../compiler-src/codegen/react-native/Compile'
import { TestCompiler as Compiler } from './test-compile'

const runtimeModule = import(FS.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts', Repo.getRoot()))

Describe('compiler: inverse boolean fields', () => {
  Test('reads and writes the negative case through its stored field', async () => {
    const compiled = await Compiler.compileCode(`
      data Books / Book { LoanedOut yes / Returned no }
      app Library { id "com.tao.test.library" version "1.0.0" name "Library" view Main }
      view Main() { render Empty() }
      view Row(Book) {
        let IsReturned = Book.Returned
        render Empty()
      }
      action MarkReturned(Book) { update Book { Returned: yes } }
      ${stubView('Empty')}
    `)

    const book = compiled.validation.entry.ast.statements.find(AST.isEntityDataDeclaration)
    Assert.defined(book, 'validated inverse-field fixture has its Books entity')
    const action = compiled.validation.entry.ast.statements
      .filter(AST.isActionDeclaration)
      .find(candidate => candidate.name === 'MarkReturned')
    Assert.defined(action, 'validated inverse-field fixture has its update action')
    const update = [...AST.streamAllContents(action)].find(AST.isUpdateStatement)
    Assert.defined(update, 'validated inverse-field fixture has its update statement')
    const updateBlock = update.block
    Assert.defined(updateBlock, 'validated inverse-field fixture has a direct update block')
    const bindings = ASTUtils.resolveDataWriteBindings(book, updateBlock.fields, false)
    Expect(bindings.diagnostics).toEqual([])
    const pair = bindings.pairs[0]
    Assert.defined(pair, 'validated inverse-field update binds one stored field')

    const returnedRead = [...AST.streamAllContents(compiled.validation.entry.ast)]
      .filter(AST.isMemberAccessExpression)
      .find(member => member.members.at(-1) === 'Returned')
    Assert.defined(returnedRead, 'validated inverse-field fixture reads Book.Returned')

    Expect(compiled.code).toMatch(/TR\.Unary\(['"]not['"], TR\.Member\(_Scope\.Book\.evaluate\(\), \["LoanedOut"\]\)\)/)
    Expect(compiled.code).toContain('TR.Data.Update(')
    Expect(compiled.code).toMatch(/\["LoanedOut"\]: TR\.Unary\(['"]not['"], TR\.Value\(true\)\),/)
    Expect(compiled.code).not.toContain('["Returned"]')

    const { default: TR } = await runtimeModule
    const readCode = Langium.toString(Compile.Expression(returnedRead))
    const evaluateRead = (loanedOut: boolean) =>
      new Function('TR', '_Scope', `return ${readCode}`)(TR, { Book: TR.Value({ LoanedOut: loanedOut }) })
    Expect(evaluateRead(true).evaluate().jsValue).toBe(false)
    Expect(evaluateRead(false).evaluate().jsValue).toBe(true)

    const writeCode = Langium.toString(Compile.DataWriteField(pair))
    const updateFields = new Function('TR', '_Scope', `return ({ ${writeCode} })`)(TR, {}) as Record<
      string,
      { evaluate(): { jsValue: unknown } }
    >
    Expect(Object.keys(updateFields)).toEqual(['LoanedOut'])
    Expect(updateFields.LoanedOut?.evaluate().jsValue).toBe(false)
  })
})
