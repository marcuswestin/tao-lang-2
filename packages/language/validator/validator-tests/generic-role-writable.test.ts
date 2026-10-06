import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Describe, Expect, stubView, Test } from '@shared/test'
import { ReactiveParametersValidator } from '../validator-src/validators/ReactiveParametersValidator'
import { testValidateCode, testValidateCodeWithErrors, validationErrorMessages } from './test-validate'

const textField = stubView('TextField where type T is text', 'mutable Value T')
const note = `
  type Title is text
  type Note is { Title Title }
`

function view(file: AST.TaoFile, name: string): AST.ViewDeclaration {
  const declaration = file.statements.find(node => AST.isViewDeclaration(node) && node.name === name)
  Expect.Is(declaration, AST.isViewDeclaration)
  return declaration
}

function render(file: AST.TaoFile, owner = 'Main'): AST.RenderStatement {
  const statement = AST.statementsOf(view(file, owner).block).find(AST.isRenderStatement)
  Expect.Is(statement, AST.isRenderStatement)
  return statement
}

Describe('generic role writable storage', () => {
  Test('admits an actual state field as a contextual mutable generic Value payload', async () => {
    const result = await testValidateCode(`
      ${textField}
      ${note}
      view Main {
        state Draft = Note { Title "old" }
        render TextField(.Value Draft.Title)
      }
    `)
    const parameter = AST.parametersOf(view(result.entry.ast, 'TextField'))[0]!
    const invocation = render(result.entry.ast)
    const argument = AST.argumentsOf(invocation)[0]!
    const role = Type.genericRoleConstructor(argument)
    Expect(role).toBeDefined()
    Expect(role!.parameter === parameter).toBe(true)
    Expect.Is(role!.value, AST.isMemberAccessExpression)
    Expect.Is(role!.value.target.ref, AST.isStateDeclaration)
    Expect(role!.value.members).toEqual(['Title'])
    Expect(argument.$cstNode?.text).toBe('.Value Draft.Title')
    Expect(ASTUtils.resolveArgumentBindings(view(result.entry.ast, 'TextField'), invocation).pairs[0]?.parameter)
      .toBe(parameter)
    Expect(ASTUtils.writableExpression(argument, parameter)).toBe(true)
  })

  Test('admits a contextual mutable role through a nested ordinary item field', async () => {
    await testValidateCode(`
      ${textField}
      ${note}
      type Envelope is { Detail Note }
      view Main {
        state Draft = Envelope { Detail Note { Title "old" } }
        render TextField(.Value Draft.Detail.Title)
      }
    `)
  })

  for (
    const [name, declarations, payload] of [
      ['readonly item field', 'let Draft = Note { Title "old" }', 'Draft.Title'],
      ['readonly alias of state', 'state Draft = Note { Title "old" } let Alias = Draft', 'Alias.Title'],
      ['raw literal', '', '"raw"'],
      ['typed literal', '', '(Title "raw")'],
      ['ordinary constructor around writable state', 'state Draft = Note { Title "old" }', '(Title Draft.Title)'],
    ]
  ) {
    Test(`rejects a ${name} inside a contextual mutable role`, async () => {
      const result = await testValidateCodeWithErrors(`
        ${textField}
        ${note}
        view Main { ${declarations} render TextField(.Value ${payload}) }
      `)
      Expect(result.entry.document.parseResult.lexerErrors.map(error => error.message)).toEqual([])
      Expect(result.entry.document.parseResult.parserErrors.map(error => error.message)).toEqual([])
      const parameter = AST.parametersOf(view(result.entry.ast, 'TextField'))[0]!
      const argument = AST.argumentsOf(render(result.entry.ast))[0]!
      Expect(Type.genericRoleConstructor(argument)?.parameter === parameter).toBe(true)
      Expect(ASTUtils.writableExpression(argument, parameter)).toBe(false)
      const message = ReactiveParametersValidator.messages.readonlyArgument('Value')
      Expect(validationErrorMessages(result)).toContain(message)
      const diagnostic = result.diagnostics.find(diagnostic => diagnostic.message === message)
      Expect(diagnostic?.range).toEqual(argument.$cstNode!.range)
    })
  }

  Test('propagates writable ownership through an authenticated generic role payload', async () => {
    const declarations = `
      ${textField}
      ${note}
      view Editor(Draft Note) { render TextField(.Value Draft.Title) }
    `
    await testValidateCode(`
      ${declarations}
      view Main { state Draft = Note { Title "old" } render Editor(Draft) }
    `)
    const result = await testValidateCodeWithErrors(`
      ${declarations}
      view Main { let Frozen = Note { Title "old" } render Editor(Frozen) }
    `)
    const parameter = AST.parametersOf(view(result.entry.ast, 'Editor'))[0]!
    Expect(ASTUtils.parameterRequiresWritable(parameter)).toBe(true)
    Expect(validationErrorMessages(result)).toContain(ReactiveParametersValidator.messages.readonlyArgument('Draft'))
  })

  Test('keeps the receiving parameter identity when checking a real generic role', async () => {
    const result = await testValidateCode(`
      ${textField}
      ${stubView('OtherField where type T is text', 'mutable Value T')}
      ${note}
      view Main { state Draft = Note { Title "old" } render TextField(.Value Draft.Title) }
    `)
    const argument = AST.argumentsOf(render(result.entry.ast))[0]!
    const receivingParameter = AST.parametersOf(view(result.entry.ast, 'OtherField'))[0]!
    Expect(Type.genericRoleConstructor(argument)?.parameter === receivingParameter).toBe(false)
    Expect(ASTUtils.writableExpression(argument, receivingParameter)).toBe(false)
    Expect(ASTUtils.writableExpression(argument)).toBe(false)
  })

  Test('rejects a derived list member inside a contextual mutable generic role', async () => {
    const result = await testValidateCodeWithErrors(`
      ${stubView('NumberField where type T is number', 'mutable Value T')}
      ${note}
      type Notes is list of Note
      view Main {
        state Drafts = Notes [Note { Title "old" }]
        render NumberField(.Value Drafts.Count)
      }
    `)
    Expect(result.entry.document.parseResult.parserErrors.map(error => error.message)).toEqual([])
    const argument = AST.argumentsOf(render(result.entry.ast))[0]!
    const parameter = AST.parametersOf(view(result.entry.ast, 'NumberField'))[0]!
    Expect(Type.genericRoleConstructor(argument)?.parameter === parameter).toBe(true)
    Expect(ASTUtils.writableExpression(argument, parameter)).toBe(false)
    Expect(validationErrorMessages(result)).toContain(ReactiveParametersValidator.messages.readonlyArgument('Value'))
  })

  for (const payload of ['Draft.Missing', 'Missing.Title']) {
    Test(`keeps unresolved payload ${payload} nonwritable`, async () => {
      const result = await testValidateCodeWithErrors(`
        ${textField}
        ${note}
        view Main { state Draft = Note { Title "old" } render TextField(.Value ${payload}) }
      `)
      Expect(result.entry.document.parseResult.parserErrors.map(error => error.message)).toEqual([])
      const argument = AST.argumentsOf(render(result.entry.ast))[0]!
      const parameter = AST.parametersOf(view(result.entry.ast, 'TextField'))[0]!
      Expect(Type.genericRoleConstructor(argument)?.parameter === parameter).toBe(true)
      Expect(ASTUtils.writableExpression(argument, parameter)).toBe(false)
    })
  }
})
