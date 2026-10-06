import { AST } from '@parser'
import { Assert } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { withValidatedFiles } from './test-validate'

Describe('validator: shared conversion failure contracts', () => {
  Test('accepts an associated converter with a typed result and one shared failure case', async () => {
    await withValidatedFiles('BookActions.tao', {
      'Library.tao': `
        public
        type ValidTitle is text

        public
        type Title is text with {
          Title as ValidTitle fails InvalidFormat {
            return ValidateTitle(Title) from ./Native.ts
          }
        }

        public
        type NewBook is Book { Title }

        public
        data Books / Book {
          Title
        }
      `,
      'BookActions.tao': `
        use ConversionFailure from @tao/core
        use NewBook, ValidTitle from ./Library

        func Convert(NewBook) fails ConversionFailure -> ValidTitle {
          return NewBook.Title as ValidTitle
        }
      `,
      'Native.ts': `export function ValidateTitle(value: string): string { return value }`,
    }, result => {
      Expect(result.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([])
      const converter = result.files.flatMap(file => AST.streamAllContents(file.ast))
        .find(AST.isAssociatedConverterDeclaration)
      Expect.Is(converter, AST.isAssociatedConverterDeclaration)
      Expect(converter.failureBounds).toEqual(['InvalidFormat'])
      const registered = result.associatedEffects
      Assert.defined(registered, 'source validation retains registered converter effects')
      Expect(registered.analyses.get(converter)?.effects).toEqual({
        purity: { violations: [], open: false },
        failures: { cases: ['InvalidFormat'], open: false },
      })
      const convert = result.entry.ast.statements.find(node =>
        AST.isFunctionDeclaration(node) && node.name === 'Convert'
      )
      Expect.Is(convert, AST.isFunctionDeclaration)
      Expect(registered.analyses.get(convert)?.effects.failures).toEqual({
        cases: ['InvalidFormat'],
        open: false,
      })
    })
  })
})
