import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { testParseSyntax } from './test-parse'

Describe('parser: named item failures', () => {
  Test('accepts named item declarations and case-set cases at both failure reference sites', async () => {
    const parsed = await testParseSyntax(`
      type InvalidInput is { Message text }
      type SaveFailure is one of Offline, Rejected
      action Save() {
        fail InvalidInput "The input is invalid."
        fail Offline "The service is offline."
      }
      action SaveNative() fails InvalidInput "The input is invalid." from ./Save.ts
    `)

    const file = parsed.entry.ast
    const invalidInput = file.statements.find(
      statement => AST.isTypeDeclaration(statement) && statement.name === 'InvalidInput',
    )
    Expect.Is(invalidInput, AST.isTypeDeclaration)
    const saveFailure = file.statements.find(
      statement => AST.isTypeDeclaration(statement) && statement.name === 'SaveFailure',
    )
    Expect.Is(saveFailure, AST.isTypeDeclaration)
    Expect.Is(saveFailure.type, AST.isCaseSetTypeExpression)
    const offline = saveFailure.type.cases.find(candidate => candidate.name === 'Offline')
    Expect.Is(offline, AST.isCaseSetCase)

    const save = file.statements.find(statement => AST.isActionDeclaration(statement) && statement.name === 'Save')
    Expect.Is(save, AST.isActionDeclaration)
    const failStatements = save.block?.statements.filter(AST.isFailStatement) ?? []
    Expect(failStatements.map(statement => statement.case.$refText)).toEqual(['InvalidInput', 'Offline'])
    Expect(failStatements[0]?.case.ref).toBe(invalidInput)
    Expect(failStatements[1]?.case.ref).toBe(offline)
    const failReferenceTarget: NonNullable<typeof failStatements[number]['case']['ref']> = invalidInput
    Expect(failReferenceTarget).toBe(invalidInput)
    const native = file.statements.find(statement =>
      AST.isActionDeclaration(statement) && statement.name === 'SaveNative'
    )
    Expect.Is(native, AST.isActionDeclaration)
    const foreign = native.foreign
    Expect.Is(foreign, AST.isForeignActionImplementation)
    const nativeFailure = foreign.failures[0]
    Expect.Is(nativeFailure, AST.isActionFailureDeclaration)
    Expect(nativeFailure.case.$refText).toBe('InvalidInput')
    Expect(nativeFailure.case.ref).toBe(invalidInput)
    const nativeReferenceTarget: NonNullable<typeof foreign.failures[number]['case']['ref']> = invalidInput
    Expect(nativeReferenceTarget).toBe(invalidInput)

    const failureTargets: AST.FailureDeclaration[] = [invalidInput, offline]
    const resolvedTargets = [failStatements[0]?.case.ref, failStatements[1]?.case.ref]
      .filter((target): target is AST.FailureDeclaration => target !== undefined)
    Expect(failureTargets.map(target => target.$type)).toEqual(['TypeDeclaration', 'CaseSetCase'])
    Expect(resolvedTargets.every(target => AST.isTypeDeclaration(target) || AST.isCaseSetCase(target))).toBe(true)
  })
})
