import { Type } from '@ast-utils'
import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { FunctionsValidator } from '../validator-src/validators/functions-validator'
import { StateValidator } from '../validator-src/validators/StateValidator'
import { accepts, validationErrorMessages, withValidationParse } from './test-validate'

const family = `
  type Base is text
  type Middle is Base
  type Leaf is Middle
  type Sibling is Base
  let ParentValue = Base "parent"
  let LeafValue = Leaf "leaf"
  let SiblingValue = Sibling "sibling"
  function TakeBase(Value Base) returns Base { return Value }
  function TakeMiddle(Value Middle) returns Middle { return Value }
  function TakeLeaf(Value Leaf) returns Leaf { return Value }
`

Describe('validator: nominal admission', () => {
  Test(
    'admits exact identities and descendants through the whole nominal ancestry',
    accepts(`
      ${family}
      let Exact = TakeLeaf(LeafValue)
      let Upward = TakeBase(LeafValue)
      let Intermediate = TakeMiddle(LeafValue)
    `),
  )

  Test(
    'rejects implicit admission of a typed parent to its descendant',
    async () => {
      await withValidationParse(`${family} let Invalid = TakeLeaf(Value: ParentValue)`, ({ result }) => {
        Expect(validationErrorMessages(result)).toEqual([
          FunctionsValidator.messages.functionLabelType('TakeLeaf', 'Value', 'Leaf', 'Base'),
        ])
      })
    },
  )

  Test(
    'rejects implicit admission between sibling nominal branches',
    async () => {
      await withValidationParse(`${family} let Invalid = TakeLeaf(Value: SiblingValue)`, ({ result }) => {
        Expect(validationErrorMessages(result)).toEqual([
          FunctionsValidator.messages.functionLabelType('TakeLeaf', 'Value', 'Leaf', 'Sibling'),
        ])
      })
    },
  )

  Test(
    'accepts explicit descendant type-fixing and raw construction alternatives',
    accepts(`
      ${family}
      let Fixed = TakeLeaf(copy ParentValue as Leaf)
      let Descendant = TakeLeaf(Leaf "parent")
      let Sibling = TakeLeaf(Leaf "sibling")
    `),
  )

  for (const argument of ['ParentValue', 'SiblingValue']) {
    Test(`rejects unnamed ${argument} without narrowing or positional fallback`, async () => {
      await withValidationParse(`${family} let Invalid = TakeLeaf(${argument})`, ({ result }) => {
        Expect(validationErrorMessages(result)).toEqual([
          FunctionsValidator.messages.functionUnmatchedArgument('TakeLeaf'),
          FunctionsValidator.messages.functionMissingArgument('TakeLeaf', 'Value'),
        ])
      })
    })
  }

  Test(
    'constructs raw literals contextually without narrowing an already nominal value',
    accepts(`
      ${family}
      let Unlabelled = TakeLeaf("raw")
      let Labelled = TakeLeaf(Value: "raw")
    `),
  )

  Test('preserves referenced identities in longhand signatures and inferred returns', async () => {
    await withValidationParse(
      `
      type A is text
      function Short(A) { return A }
      function Same(A A) { return A }
      function Renamed(Value A) { return Value }
      let Value = A "named"
      let First = Same(Value)
      let Second = Renamed(Value)
      let Projected = Renamed(Renamed.Value "projected")
    `,
      ({ result }) => {
        Expect(validationErrorMessages(result)).toEqual([])
        for (const name of ['Short', 'Same', 'Renamed']) {
          const declaration = result.entry.ast.statements.find(statement =>
            AST.isFunctionDeclaration(statement) && statement.name === name
          )
          Expect.Is(declaration, AST.isFunctionDeclaration)
          const parameter = AST.parametersOf(declaration)[0]!
          Expect(Type.displayName(Type.ofParameter(parameter))).toBe('A')
          Expect(Type.identityKey(Type.ofParameter(parameter))).toMatch(/#A$/)
          Expect(Type.identityKey(Type.ofFunctionReturn(declaration))).toMatch(/#A$/)
        }
      },
    )
  })

  Test('infers the ancestor result in either return order', async () => {
    await withValidationParse(
      `
      ${family}
      function ParentFirst(Flag boolean) {
        if Flag { return ParentValue }
        return LeafValue
      }
      function LeafFirst(Flag boolean) {
        if Flag { return LeafValue }
        return ParentValue
      }
    `,
      ({ result }) => {
        Expect(validationErrorMessages(result)).toEqual([])
        for (const name of ['ParentFirst', 'LeafFirst']) {
          const declaration = result.entry.ast.statements.find(statement =>
            AST.isFunctionDeclaration(statement) && statement.name === name
          )
          Expect.Is(declaration, AST.isFunctionDeclaration)
          Expect(Type.displayName(Type.ofFunctionReturn(declaration))).toBe('Base')
        }
      },
    )
  })

  Test(
    'rejects inferring a sibling as the shared result type',
    async () => {
      await withValidationParse(
        `
        ${family}
        function Mixed(Flag boolean) {
          if Flag { return LeafValue }
          return SiblingValue
        }
      `,
        ({ result }) => {
          Expect(validationErrorMessages(result)).toEqual([
            FunctionsValidator.messages.functionReturnInference('Mixed', 'Leaf', 'Sibling'),
          ])
        },
      )
    },
  )

  Test(
    'keeps named action results assignable upward through ordinary action binding',
    accepts(`
      type Base is text
      type Leaf is Base
      action Read() returns Leaf from ./Bindings.ts
      action Consume(Value Base) { }
      action Paste() { let Result = do Read() do Consume(Result) }
    `),
  )

  Test('retains scoped identities for inline primitive roles and their descendants', async () => {
    await withValidationParse(
      `
      function First(Value text) { return Value }
      function Second(Value text) { return Value }
      type Detailed is First.Value
      let Raw = First("raw")
      let Derived = Detailed "derived"
      let Accepted = First(Derived)
    `,
      ({ result }) => {
        Expect(validationErrorMessages(result)).toEqual([])
        for (const name of ['First', 'Second']) {
          const declaration = result.entry.ast.statements.find(statement =>
            AST.isFunctionDeclaration(statement) && statement.name === name
          )
          Expect.Is(declaration, AST.isFunctionDeclaration)
          const parameter = AST.parametersOf(declaration)[0]!
          Expect(Type.displayName(Type.ofParameter(parameter))).toBe(`${name}.Value`)
          Expect(Type.identityKey(Type.ofParameter(parameter))).toMatch(new RegExp(`#${name}\\.Value$`))
          Expect(Type.displayName(Type.ofFunctionReturn(declaration))).toBe(`${name}.Value`)
        }
        const derived = result.entry.ast.statements.find(statement =>
          AST.isTypeDeclaration(statement) && statement.name === 'Detailed'
        )
        Expect.Is(derived, AST.isTypeDeclaration)
        Expect(Type.displayName(Type.ofDefinition(derived))).toBe('Detailed')
        Expect(Type.identityKey(Type.ofDefinition(derived))).toMatch(/#Detailed$/)
      },
    )
  })

  Test(
    'rejects sibling descendants of one scoped inline role',
    async () => {
      await withValidationParse(
        `
        function First(Value text) { return Value }
        type Detailed is First.Value
        type Other is First.Value
        function Take(Value Detailed) { return Value }
        let Invalid = Take(Value: Other "value")
      `,
        ({ result }) => {
          Expect(validationErrorMessages(result)).toEqual([
            FunctionsValidator.messages.functionLabelType('Take', 'Value', 'Detailed', 'Other'),
          ])
        },
      )
    },
  )

  Test('keeps field construction admission separate from callable admission and checks list elements', async () => {
    await withValidationParse(
      `
      type Base is text
      type Leaf is Base
      type Age is number
      type Numbers is list of number
      type Payload is { Label Base, Values Numbers, Age number }
      let Label = Leaf "label"
      let Good = [1]
      let Bad = ["bad"]
      let OuterAge = Age 42
    `,
      ({ result }) => {
        Expect(validationErrorMessages(result)).toEqual([])
        const payload = result.entry.ast.statements.find(statement =>
          AST.isTypeDeclaration(statement) && statement.name === 'Payload'
        )
        Expect.Is(payload, AST.isTypeDeclaration)
        Expect.Is(payload.type, AST.isItemTypeExpression)
        const fields = payload.type.properties.map(Type.ofProperty)
        const aliases = result.entry.ast.statements.filter(AST.isAliasDeclaration)
        const types = aliases.map(alias => Type.ofValueDeclaration(alias))
        Expect(Type.displayName(fields[0]!)).toBe('Payload.Label')
        Expect(Type.isAssignable(types[0]!, fields[0]!)).toBe(false)
        Expect(Type.isAssignableToConstruction(types[0]!, fields[0]!)).toBe(true)
        Expect(Type.isAssignableToConstruction(types[1]!, fields[1]!)).toBe(true)
        Expect(Type.isAssignableToConstruction(types[2]!, fields[1]!)).toBe(false)
        Expect(Type.isAssignableToConstruction(types[3]!, fields[2]!)).toBe(false)
      },
    )
  })

  Test('admits descendants at named slots while retaining optional and list boundaries', async () => {
    await withValidationParse(
      `
      type Base is { }
      type Leaf is Base with { }
      type Other is { }
      type Payload is { Value Base, Maybe Base?, Values list of Base }
      let Child = Leaf { }
      let Unrelated = Other { }
      let Children = [Child]
      let Others = [Unrelated]
      let Absent = none
    `,
      ({ result }) => {
        Expect(validationErrorMessages(result)).toEqual([])
        const payload = result.entry.ast.statements.find(statement =>
          AST.isTypeDeclaration(statement) && statement.name === 'Payload'
        )
        Expect.Is(payload, AST.isTypeDeclaration)
        Expect.Is(payload.type, AST.isItemTypeExpression)
        const fields = payload.type.properties.map(Type.ofProperty)
        const aliases = result.entry.ast.statements.filter(AST.isAliasDeclaration)
        const [child, unrelated, children, others, absent] = aliases.map(alias => Type.ofValueDeclaration(alias))
        for (const field of fields) {
          Expect(Type.isAssignableToSlot(child!, field)).toBe(true)
          Expect(Type.isAssignableToSlot(unrelated!, field)).toBe(false)
        }
        Expect(Type.isAssignableToSlot(children!, fields[2]!)).toBe(true)
        Expect(Type.isAssignableToSlot(others!, fields[2]!)).toBe(false)
        Expect(Type.isAssignable(child!, fields[0]!)).toBe(false)
        const optional = Type.ofPropertyRead(payload.type.properties[1]!)
        Expect(optional.kind).toBe('union')
        Expect(Type.isAssignableToSlot(child!, optional)).toBe(true)
        Expect(Type.isAssignableToSlot(unrelated!, optional)).toBe(false)
        Expect(Type.isAssignableToSlot(absent!, optional)).toBe(true)
        Expect(Type.isAssignableToSlot({ kind: 'union', members: [child!, absent!] }, optional)).toBe(true)
        Expect(Type.isAssignableToSlot({ kind: 'union', members: [child!, unrelated!] }, optional)).toBe(false)
      },
    )
  })

  Test(
    'writes optional named field contracts from their declared values',
    accepts(`
    type Base is { }
    type Leaf is Base with { }
    type Payload is { Maybe Base? }
    action Update(copy Result Payload, Value Leaf?) { set Result.Maybe = Value }
  `),
  )

  Test('rejects unrelated optional values at named member writes', async () => {
    await withValidationParse(
      `
      type Base is { }
      type Other is { }
      type Payload is { Maybe Base? }
      action Update(copy Result Payload, Value Other?) { set Result.Maybe = Value }
    `,
      ({ result }) => {
        Expect(validationErrorMessages(result)).toEqual([
          StateValidator.messages.mutableSetTypeMismatch('Result.Maybe', 'Payload.Maybe | none', 'Other | none'),
        ])
      },
    )
  })

  Test('rejects list-element narrowing at named member writes', async () => {
    await withValidationParse(
      `
      type Base is text
      type Leaf is Base
      type Leaves is list of Leaf
      type Bases is list of Base
      type Payload is { Values Leaves }
      action Update(copy Result Payload, Value Bases) { set Result.Values = Value }
    `,
      ({ result }) => {
        Expect(validationErrorMessages(result)).toEqual([
          StateValidator.messages.mutableSetTypeMismatch('Result.Values', 'Payload.Values', 'Bases'),
        ])
      },
    )
  })

  Test('keeps whole-parameter writes to scoped field identities strict', async () => {
    await withValidationParse(
      `
      type Base is text
      type Payload is { Value Base }
      action Update(copy Value Payload.Value, Other Base) { set Value = Other }
    `,
      ({ result }) => {
        Expect(validationErrorMessages(result)).toEqual([
          StateValidator.messages.mutableSetTypeMismatch('Value', 'Payload.Value', 'Base'),
        ])
      },
    )
  })
})
