import { Type } from '@ast-utils'
import { AST, Parser } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { configuredItemValidationMessages } from '../validator-src/validators/configured-item-validator'
import { accepts, rejectsFiles, type TaoFiles } from './test-validate'

Describe('abstract types', () => {
  Test('stores abstractness on the declared type without reserving a family name', async () => {
    const parsed = await Parser.parseCode(
      `
      abstract type NumericFamily is numeric
      type ConcreteNumber is NumericFamily with { units { points 1 (default) } }
      type OrdinaryNumber is number
    `,
      { validation: false },
    )
    Expect(parsed.entry.document.parseResult.lexerErrors).toEqual([])
    Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])
    const declarations = parsed.entry.ast.statements.filter(AST.isTypeDeclaration)
    const [numericFamily, concreteNumber, ordinaryNumber] = declarations
    Expect.Is(numericFamily, AST.isTypeDeclaration)
    Expect.Is(concreteNumber, AST.isTypeDeclaration)
    Expect.Is(ordinaryNumber, AST.isTypeDeclaration)
    Expect(numericFamily.abstract).toBe(true)
    Expect(ordinaryNumber.abstract).toBe(false)
    Expect(Type.isAbstractDomain(Type.ofDefinition(numericFamily))).toBe(true)
    Expect(Type.isAbstractDomain(Type.ofDefinition(concreteNumber))).toBe(false)
  })

  Test(
    'rejects direct and aliased numeric construction of an abstract family',
    rejectsFiles(
      {
        'Main.tao': `
          use package @families as families
          type RenamedFamily = families.NumericFamily
          let Renamed = RenamedFamily 3
        `,
        '@families/Family.tao': `
          public abstract type NumericFamily is numeric
          let Direct = NumericFamily 3
        `,
      } satisfies TaoFiles,
      configuredItemValidationMessages.abstractTypeConstruction('NumericFamily'),
      configuredItemValidationMessages.abstractTypeConstruction('RenamedFamily'),
    ),
  )

  Test(
    'keeps ordinary named number construction available',
    accepts(`
      type OrdinaryNumber is number
      let Amount = OrdinaryNumber 3
    `),
  )
})
