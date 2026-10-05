import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { bridgeValidationMessages } from '../validator-src/validators/bridge-validator'
import { accepts, rejects, testValidateCodeWithErrors, validationErrorMessages } from './test-validate'

Describe('validator: native quantity result contracts', () => {
  Test(
    'rejects an abstract numeric result from an ordinary native function wrapper',
    rejects(
      `abstract type Quantity is numeric
       func Native() -> Quantity { return Export() from ./Native.ts }`,
      bridgeValidationMessages.abstractNumericResult,
    ),
  )

  Test('rejects an abstract numeric member in a union result contract', async () => {
    const result = await testValidateCodeWithErrors(`
      abstract type Quantity is numeric
      func Native() -> Quantity | text { return Export() from ./Native.ts }
    `)
    const fn = result.entry.ast.statements.find(AST.isFunctionDeclaration)
    Expect.Is(fn, AST.isFunctionDeclaration)
    Expect.Is(fn.returnType, AST.isUnionTypeExpression)
    Expect(validationErrorMessages(result)).toEqual([bridgeValidationMessages.abstractNumericResult])
  })

  Test('rejects abstract numeric native returns from associated methods and converter targets', async () => {
    const result = await testValidateCodeWithErrors(`
      abstract type Quantity is numeric
      type Token is text with {
        func Native() -> Quantity { return Export() from ./Native.ts }
        Token as Quantity { return Convert() from ./Native.ts }
      }
    `)
    Expect(AST.streamAllContents(result.entry.ast).filter(AST.isFromExpression)).toHaveLength(2)
    Expect(validationErrorMessages(result)).toEqual([
      bridgeValidationMessages.abstractNumericResult,
      bridgeValidationMessages.abstractNumericResult,
    ])
  })

  Test(
    'keeps abstract numeric inputs legal when the native result contract is concrete',
    accepts(`
      abstract type Quantity is numeric
      type Metres is numeric
      func Native(Value Quantity) -> Metres { return Export(Value) from ./Native.ts }
    `),
  )

  Test(
    'accepts contextual Self as the native result specialized to the actual numeric receiver',
    accepts(`
      abstract type Scalar is numeric with {
        static func +(Left Self, Right Self) -> Self { return Add(Left, Right) from ./Native.ts }
      }
    `),
  )

  Test(
    'accepts an instance native Self result anchored to its real contextual receiver',
    accepts(`
      abstract type Scalar is numeric with {
        func Same() -> Self { return Same(Scalar) from ./Native.ts }
      }
    `),
  )

  for (const inputs of ['', 'Value Scalar']) {
    Test(
      `rejects a static native Self result without a Self input: ${inputs || 'no inputs'}`,
      rejects(
        `
        abstract type Scalar is numeric with {
          static func Make(${inputs}) -> Self { return Make() from ./Native.ts }
        }
      `,
        bridgeValidationMessages.unanchoredSelfResult,
      ),
    )
  }

  Test(
    'accepts concrete native results for ordinary methods and converters',
    accepts(`
      abstract type Quantity is numeric
      type Metres is numeric
      type Token is text with {
        func Native() -> Metres { return Export() from ./Native.ts }
        Token as Metres { return Convert() from ./Native.ts }
      }
      func Native() -> Metres { return Export() from ./Native.ts }
    `),
  )
})
