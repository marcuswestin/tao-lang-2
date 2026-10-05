import { NumericUnits, Type } from '@ast-utils'
import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { configuredItemValidationMessages } from '../validator-src/validators/configured-item-validator'
import { FunctionsValidator } from '../validator-src/validators/functions-validator'
import { NumericUnitsValidationMessages as messages } from '../validator-src/validators/NumericUnitsValidationMessages'
import { typeValidationMessages } from '../validator-src/validators/types-validator'
import { accepts, acceptsFiles, rejects, validationErrorMessages, withValidationParse } from './test-validate'

const measure = 'type Measure is numeric with { units { seconds 1 (default), minutes 60 } }'

Describe('validator: numeric units', () => {
  Test(
    'accepts raw numeric constructors and preserves unrelated literal and item constructors',
    accepts(`
    type Storage is numeric
    type Label is text
    type Count is number
    type Values is list of number
    type Holder is { Label, Count, Values, Stored Storage }
    let Raw = Storage 2
    let Name = Label "Measure"
    let Amount = Count 3
    let Entries = Values [1, 2]
    let Held = Holder { Label: Name, Count: Amount, Values: Entries, Stored: Raw }
  `),
  )

  Test(
    'does not fabricate an owning quantity through a type-first number literal',
    rejects(
      `
    ${measure}
    let Wrong = Measure 2
  `,
      configuredItemValidationMessages.constructorValueType('Measure', 'Measure', 'number'),
    ),
  )

  Test(
    'accepts signed, grouped, qualified construction and ordinary quantity passage',
    accepts(`
    ${measure}
    function Keep(Value Measure) returns Measure { return Value }
    function Input(Value number) returns Measure { return (Value + 1) Measure.seconds }
    let Negative = -2 seconds
    let Grouped = (-2) seconds
    let Same = Keep(Negative)
    let Copied = copy Same
    type Holder is { Value Measure }
    let Held = Holder { Value: Copied }
    let Selected = Keep(Held.Value)
  `),
  )

  Test(
    'accepts unowned numeric storage and number passage without a units table',
    accepts(`
    function Keep(Value numeric) returns numeric { return Value }
    let Stored is numeric = 2
    let Same = Keep(Stored)
    let FromNumber = Keep(3)
    type Storage is { Value numeric }
    let Held = Storage { Value: 4 }
    let FromField = Keep(Held.Value)
  `),
  )

  Test(
    'preserves legacy duration accessors and their operations',
    accepts(`
    function Legacy(Value duration) returns duration { return Value + 2.ms }
    let Wait = Legacy(3.ms)
  `),
  )

  Test(
    'accepts transparent imported aliases without creating a new unit owner',
    acceptsFiles({
      'Main.tao': `
      use package @measures as measures
      type Renamed = measures.Measure
      function Keep(Value Renamed) returns Renamed { return Value }
      let Quantity = 2 measures.Measure.seconds
      let Same = Keep(Quantity)
    `,
      '@measures/Measure.tao': `public ${measure}`,
    }),
  )

  Test(
    'preserves quantity identity through scoped fields, parameters, aliases and cells',
    accepts(`
    ${measure}
    function Keep(Value Measure) returns Measure { return Value }
    type Holder is { Value Measure }
    view Main() {
      state Current = 2 seconds
      let Held = Holder { Value: Current }
      action Replace(Value Measure) { set Current = Value }
      action Save() { do Replace(Keep(Held.Value)) }
      render Empty
    }
    view Empty { render inject \`\`\`ts return null \`\`\` }
  `),
  )

  for (const operator of ['+', '-', '*', '/', '<', '<=', '>', '>=', '==', '!=', 'and', 'or']) {
    for (const operand of ['numeric', 'Measure']) {
      Test(
        `rejects ${operator} on ${operand} before legacy operator fallback`,
        rejects(
          `
        ${measure}
        function Wrong(Left ${operand}, Right ${operand}) { return Left ${operator} Right }
      `,
          messages.operator(operator),
        ),
      )
    }
    Test(
      `rejects ${operator} when the other operand is unresolved`,
      rejects(
        `
      function Wrong(Left numeric) { return Left ${operator} Missing }
    `,
        messages.operator(operator),
      ),
    )
  }

  for (const operand of ['numeric?', 'Measure?']) {
    Test(
      `rejects equality on optional ${operand} before legacy fallback`,
      rejects(
        `
      ${measure}
      function Wrong(Value ${operand}) returns boolean { return Value == Value }
    `,
        messages.operator('=='),
      ),
    )
  }

  for (const operator of ['-', 'not']) {
    for (const operand of ['numeric', 'Measure']) {
      Test(
        `rejects unary ${operator} on ${operand}`,
        rejects(
          `
        ${measure}
        function Wrong(Value ${operand}) { return ${operator} Value }
      `,
          messages.operator(operator),
        ),
      )
    }
  }

  Test(
    'rejects right-hand numeric operands before text, duration and boolean fallback',
    rejects(
      `
    function Text(Value numeric) { return "x" + Value }
    function Duration(Value numeric) { return 3.ms + Value }
    function Boolean(Value numeric) { return true or Value }
  `,
      messages.operator('+'),
      messages.operator('or'),
    ),
  )

  Test(
    'distinguishes signed construction from negating a constructed quantity',
    rejects(
      `
    ${measure}
    let Wrong = -(2 seconds)
  `,
      messages.operator('-'),
    ),
  )

  Test(
    'rejects passing a quantity into a number context',
    rejects(
      `
    ${measure}
    function Number(Value number) { return Value }
    let Wrong = Number(Value: 2 seconds)
  `,
      FunctionsValidator.messages.functionLabelType('Number', 'Value', 'Number.Value', 'Measure'),
    ),
  )

  Test(
    'never constructs a quantity from the expected parameter type alone',
    rejects(
      `
    ${measure}
    function Keep(Value Measure) { return Value }
    let Wrong = Keep(Value: 2)
  `,
      FunctionsValidator.messages.functionLabelType('Keep', 'Value', 'Measure', 'number'),
    ),
  )

  for (const input of ['("text")', '(2 seconds)', '(Value)']) {
    Test(
      `rejects non-number grouped input ${input}`,
      rejects(
        `
      ${measure}
      function Wrong(Value numeric) { return ${input} seconds }
    `,
        messages.constructionInput,
      ),
    )
  }

  Test(
    'rejects a units block on an item rather than a numeric owner',
    rejects(
      `
    type Wrong is { units { seconds 1 (default) } }
  `,
      messages.blockPlacement,
    ),
  )
  Test(
    'rejects a units block on a number-derived owner',
    rejects(
      `
    type Wrong is number with { units { seconds 1 (default) } }
  `,
      messages.blockPlacement,
    ),
  )
  Test(
    'rejects a units block inside an inline parameter type',
    rejects(
      `
    function Wrong(Value numeric with { units { seconds 1 (default) } }) { return Value }
  `,
      messages.blockPlacement,
    ),
  )
  Test(
    'rejects multiple directly owned tables',
    rejects(
      `
    type Wrong is numeric with { units { seconds 1 (default) } units { minutes 60 (default) } }
  `,
      messages.multipleBlocks,
    ),
  )
  Test('rejects an empty table', rejects('type Wrong is numeric with { units { } }', messages.emptyBlock))
  Test(
    'rejects duplicate unit names',
    rejects(
      `
    type Wrong is numeric with { units { seconds 1 (default), seconds 2 } }
  `,
      messages.duplicateUnit('seconds'),
    ),
  )
  for (const scale of ['0', '-1', '9'.repeat(400)]) {
    Test(
      `rejects scale ${scale.length > 20 ? 'nonfinite decimal' : scale}`,
      rejects(
        `
      type Wrong is numeric with { units { seconds ${scale} (default) } }
    `,
        messages.scale('seconds'),
      ),
    )
  }
  for (const units of ['seconds 1', 'seconds 1 (default), minutes 60 (default)']) {
    Test(
      `rejects a table without exactly one default: ${units}`,
      rejects(
        `
      type Wrong is numeric with { units { ${units} } }
    `,
        messages.defaultUnit,
      ),
    )
  }
  Test(
    'rejects construction using an invalid owner table',
    rejects(
      `
    type Wrong is numeric with { units { seconds 0 (default) } }
    let Invalid = 2 seconds
  `,
      messages.invalidTable,
    ),
  )

  Test('never guesses an ambiguous owner from the expected parameter type', async () => {
    await withValidationParse(
      `
      ${measure}
      type Other is numeric with { units { seconds 1 (default) } }
      function Keep(Value Measure) returns Measure { return Value }
      let Wrong = Keep(2 seconds)
    `,
      ({ result }) => {
        Expect(validationErrorMessages(result).some(message => message.includes('seconds'))).toBe(true)
        const suffix = AST.streamAllContents(result.entry.ast).find(AST.isNumericUnitConstruction)
        Expect.Is(suffix, AST.isNumericUnitConstruction)
        Expect(suffix.unit.ref).toBeUndefined()
      },
    )
  })

  Test('does not expose an ancestor unit table through a nominal descendant', async () => {
    await withValidationParse(
      `
      ${measure}
      type Descendant is Measure
      let Wrong = 2 Descendant.seconds
    `,
      ({ result }) => {
        Expect(validationErrorMessages(result).some(message => message.includes('Descendant.seconds'))).toBe(true)
        const suffix = AST.streamAllContents(result.entry.ast).find(AST.isNumericUnitConstruction)
        Expect.Is(suffix, AST.isNumericUnitConstruction)
        Expect(suffix.unit.ref).toBeUndefined()
      },
    )
  })

  Test('keeps nominal descendants unowned and prevents quantity erasure and owner changes', async () => {
    await withValidationParse(
      `
      ${measure}
      type Descendant is Measure
      type Other is numeric with { units { items 1 (default) } }
      function Raw(Value numeric) { return Value }
      function Number(Value number) { return Value }
      function Changed(Value Other) { return Value }
      let Quantity = 2 seconds
      let Erased = Raw(Value: Quantity)
      let NumberErased = Number(Value: Quantity)
      let ChangedOwner = Changed(Value: Quantity)
      let CastRaw = copy Quantity as numeric
      let CastNumber = copy Quantity as number
      let CastOther = copy Quantity as Other
    `,
      ({ result }) => {
        const descendant = result.entry.ast.statements.find(statement =>
          AST.isTypeDeclaration(statement) && statement.name === 'Descendant'
        )
        Expect.Is(descendant, AST.isTypeDeclaration)
        Expect(NumericUnits.declarationPlan(descendant)).toBeUndefined()
        Expect(Type.quantityOwner(Type.ofDefinition(descendant))).toBeUndefined()
        const owner = result.entry.ast.statements.find(statement =>
          AST.isTypeDeclaration(statement) && statement.name === 'Measure'
        )
        const other = result.entry.ast.statements.find(statement =>
          AST.isTypeDeclaration(statement) && statement.name === 'Other'
        )
        Expect.Is(owner, AST.isTypeDeclaration)
        Expect.Is(other, AST.isTypeDeclaration)
        const quantities = { kind: 'list' as const, element: Type.ofDefinition(owner) }
        const raw = { kind: 'list' as const, element: { kind: 'primitive' as const, primitive: 'number' as const } }
        const changed = { kind: 'list' as const, element: Type.ofDefinition(other) }
        Expect(Type.isCastCompatible(quantities, quantities)).toBe(true)
        Expect(Type.isCastCompatible(quantities, raw)).toBe(false)
        Expect(Type.isCastCompatible(quantities, changed)).toBe(false)
        const errors = validationErrorMessages(result)
        for (
          const [name, expected] of [['Raw', 'Raw.Value'], ['Number', 'Number.Value'], ['Changed', 'Other']] as const
        ) {
          Expect(errors).toContain(FunctionsValidator.messages.functionLabelType(name, 'Value', expected, 'Measure'))
        }
        for (const target of ['numeric', 'number', 'Other']) {
          Expect(errors).toContain(typeValidationMessages.typeFixIncompatible(target))
        }
      },
    )
  })
})
