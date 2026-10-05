import { ASTUtils, Type } from '@ast-utils'
import { AST, Parser } from '@parser'
import { Describe, Expect, stubView, Test } from '@shared/test'
import { configuredItemValidationMessages } from '../validator-src/validators/configured-item-validator'
import {
  testValidateCode,
  testValidateCodeWithErrors,
  validationErrorMessages,
  withValidatedFiles,
} from './test-validate'

async function parse(source: string): Promise<AST.TaoFile> {
  const parsed = await Parser.parseCode(source, { validation: false })
  Expect(parsed.entry.document.parseResult.lexerErrors.map(error => error.message)).toEqual([])
  Expect(parsed.entry.document.parseResult.parserErrors.map(error => error.message)).toEqual([])
  Expect(parsed.diagnostics.map(diagnostic => diagnostic.message)).toEqual([])
  return parsed.entry.ast
}

function view(file: AST.TaoFile, name: string): AST.ViewDeclaration {
  const declaration = file.statements.find(node => AST.isViewDeclaration(node) && node.name === name)
  Expect.Is(declaration, AST.isViewDeclaration)
  return declaration
}

function render(file: AST.TaoFile, owner: string): AST.RenderStatement {
  const statement = AST.statementsOf(view(file, owner).block).find(AST.isRenderStatement)
  Expect.Is(statement, AST.isRenderStatement)
  return statement
}

const pair = `
  ${stubView('Text', 'Value text')}
  type Name is text
  view Pair where type T is text (Left T, Right T) { render Text("") }
`

Describe('generic view invocation consumers', () => {
  Test('infers transparent view aliases against real target parameters and generic identities', async () => {
    await withValidatedFiles('Main.tao', {
      'Main.tao': `
        use package @middle
        type Name is text
        view Published = middle.Forwarded
        view Main(NameValue Name) { render Published(NameValue) }
      `,
      '@middle/Views.tao': `
        use package @widgets
        public view Forwarded = widgets.Tile
      `,
      '@widgets/Views.tao': `
        public view Tile where type T is text (Value T) { render "" }
      `,
    }, result => {
      const selected = view(result.entry.ast, 'Published')
      const target = AST.viewAliasTarget(selected)
      Expect.Is(target, AST.isViewDeclaration)
      Expect(target.name).toBe('Tile')
      const parameter = AST.parametersOf(target)[0]!
      const generic = target.genericParameters[0]!
      const invocation = render(result.entry.ast, 'Main')
      const resolved = ASTUtils.resolveRenderInvocation(invocation)
      Expect(resolved.view === selected).toBe(true)
      Expect(resolved.diagnostics.map(diagnostic => diagnostic.kind)).toEqual([])
      Expect(resolved.genericDiagnostics?.map(diagnostic => diagnostic.kind)).toEqual([])
      Expect(resolved.pairs[0]?.parameter === parameter).toBe(true)
      Expect(resolved.pairs[0]?.argument === AST.argumentsOf(invocation)[0]).toBe(true)
      Expect(resolved.bindings?.size).toBe(1)
      Expect(Type.displayName(resolved.bindings!.get(generic)!)).toBe('Name')
      Expect(Type.displayName(resolved.parameterTypes!.get(parameter)!)).toBe('Name')
      Expect(resolved.transportTypes!.get(parameter)!.genericParameter === generic).toBe(true)
      Expect(resolved.result).toEqual({ kind: 'primitive', primitive: 'rendered' })
    })
  })

  Test('checks raw contextual view roles after a typed sibling anchors the shared generic', async () => {
    for (const arguments_ of ['.Left NameValue, .Right "raw"', '.Right "raw", .Left NameValue']) {
      const result = await testValidateCode(`
        ${pair}
        view Main(NameValue Name) { render Pair(${arguments_}) }
      `)
      const declaration = view(result.entry.ast, 'Pair')
      const parameters = AST.parametersOf(declaration)
      const invocation = render(result.entry.ast, 'Main')
      const resolved = ASTUtils.resolveRenderInvocation(invocation)
      Expect(resolved.genericDiagnostics?.map(diagnostic => diagnostic.kind)).toEqual([])
      Expect(resolved.pairs).toHaveLength(2)
      Expect(Type.displayName(resolved.bindings!.get(declaration.genericParameters[0]!)!)).toBe('Name')
      for (const parameter of parameters) {
        Expect(Type.displayName(resolved.parameterTypes!.get(parameter)!)).toBe('Name')
      }
      for (const argument of AST.argumentsOf(invocation)) {
        const role = Type.genericRoleConstructor(argument)
        Expect(role).toBeDefined()
        Expect(parameters.includes(role!.parameter)).toBe(true)
        Expect(resolved.pairs.find(pair => pair.argument === argument)?.parameter === role!.parameter).toBe(true)
      }
    }
  })

  Test('locates an invalid raw view role payload against its specialized literal domain', async () => {
    const result = await testValidateCodeWithErrors(`
      ${pair}
      view Main(NameValue Name) { render Pair(.Left NameValue, .Right 9) }
    `)
    Expect(result.entry.document.parseResult.lexerErrors.map(error => error.message)).toEqual([])
    Expect(result.entry.document.parseResult.parserErrors.map(error => error.message)).toEqual([])
    const invocation = render(result.entry.ast, 'Main')
    const argument = AST.argumentsOf(invocation)[1]!
    Expect.Is(argument.value, AST.isConfigurationConstructor)
    Expect(argument.value.$cstNode?.text).toBe('.Right 9')
    const diagnostic = result.diagnostics.find(diagnostic =>
      diagnostic.message === configuredItemValidationMessages.constructorShape('Right', 'text')
    )
    Expect(diagnostic).toBeDefined()
    Expect(diagnostic?.source).toBe('validator')
    Expect(diagnostic?.range).toEqual(argument.value.$cstNode!.range)
    Expect(validationErrorMessages(result)).toContain(
      configuredItemValidationMessages.constructorShape('Right', 'text'),
    )
  })

  Test('keeps raw role payloads from manufacturing generic inference anchors', async () => {
    const file = await parse(`
      ${pair}
      view Main { render Pair(.Left "one", .Right "two") }
    `)
    const declaration = view(file, 'Pair')
    const invocation = render(file, 'Main')
    const resolved = ASTUtils.resolveRenderInvocation(invocation)
    Expect(resolved.bindings?.size).toBe(0)
    Expect(resolved.genericDiagnostics?.map(diagnostic => diagnostic.kind)).toEqual(['uninferred-generic'])
    Expect(resolved.genericDiagnostics?.[0]?.parameter === declaration.genericParameters[0]).toBe(true)
    const arguments_ = AST.argumentsOf(invocation)
    const diagnosed = resolved.genericDiagnostics?.[0]?.arguments
    Expect(arguments_).toHaveLength(2)
    Expect(diagnosed).toHaveLength(2)
    Expect(diagnosed?.map((argument, index) => argument === arguments_[index])).toEqual([true, true])
  })

  Test('forwards occurrence omission metadata through generic and ordinary view binding', async () => {
    const file = await parse(`
      ${stubView('Text', 'Value text')}
      type Name is text
      view Generic where type T is text (Value T, Footer number) { render Text("") }
      view Ordinary(Value Name, Footer number) { render Text("") }
      view GenericCaller(NameValue Name) { render Generic(NameValue) }
      view OrdinaryCaller(NameValue Name) { render Ordinary(NameValue) }
    `)
    for (const name of ['Generic', 'Ordinary']) {
      const declaration = view(file, name)
      const footer = AST.parametersOf(declaration)[1]!
      const invocation = render(file, `${name}Caller`)
      const required = ASTUtils.resolveRenderInvocation(invocation)
      Expect(required.diagnostics).toHaveLength(1)
      Expect(required.diagnostics.map(diagnostic => diagnostic.kind)).toEqual(['missing-argument'])
      const missing = required.diagnostics[0]!
      Expect(missing.kind === 'missing-argument' && missing.parameter === footer).toBe(true)
      const resolved = ASTUtils.resolveRenderInvocation(invocation, {
        parameterOmissible: parameter => parameter === footer,
      })
      Expect(resolved.diagnostics.map(diagnostic => diagnostic.kind)).toEqual([])
      Expect(resolved.pairs).toHaveLength(1)
      Expect(resolved.pairs[0]?.parameter === AST.parametersOf(declaration)[0]).toBe(true)
      if (name === 'Generic') {
        Expect(resolved.genericDiagnostics?.map(diagnostic => diagnostic.kind)).toEqual([])
        Expect(Type.displayName(resolved.bindings!.get(declaration.genericParameters[0]!)!)).toBe('Name')
      }
    }
  })
})
