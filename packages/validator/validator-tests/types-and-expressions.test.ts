import { Type } from '@ast-utils'
import { AST } from '@parser'
import { Diagnostics, FS } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { Workspace } from '@workspace'
import { ExpressionsValidator } from '../validator-src/validators/expressions-validator'
import { FunctionalCoreValidator } from '../validator-src/validators/FunctionalCoreValidator'
import { InvocationsValidator } from '../validator-src/validators/invocations-validator'
import { typeValidationMessages } from '../validator-src/validators/types-validator'
import {
  fence,
  testValidateCode,
  testValidateCodeWithErrors,
  tsFence,
  validationErrorMessages,
  withValidationParse,
} from './test-validate'

const inferExpressionType = ExpressionsValidator.inferExpressionType
const invocationValidationMessages = InvocationsValidator.messages

Describe('Tao validator structural diagnostics', () => {
  Test('exposes Typir services for primitive expression inference', async () => {
    await withValidationParse(
      `
      app MyApp { view MainView }
      let Greeting = "Hello"
      let Count = 3
      view MainView { }
    `,
      ({ result, workspace }) => {
        const aliases = result.entry.ast.statements.filter(AST.isAliasDeclaration)

        Expect(ExpressionsValidator.inferExpressionType(aliases[0]!.value, workspace.typir)).toBe('text')
        Expect(ExpressionsValidator.inferExpressionType(aliases[1]!.value, workspace.typir)).toBe('number')
      },
    )
  })

  Test('infers action and stateful expression types', async () => {
    await withValidationParse(
      `
      app MyApp { view MainView }
      let SaveAction = action { }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        state Count = 3
        let DisplayCount = Count
        render Text("hi")
      }
    `,
      ({ result, workspace }) => {
        const actionAlias = result.entry.ast.statements.find(statement =>
          AST.isAliasDeclaration(statement) && statement.name === 'SaveAction'
        )
        Expect.Is(actionAlias, AST.isAliasDeclaration)
        const mainView = result.entry.ast.statements.find(statement =>
          AST.isViewDeclaration(statement) && statement.name === 'MainView'
        )
        Expect.Is(mainView, AST.isViewDeclaration)
        const displayAlias = AST.blockStatementOf(mainView, {
          find: statement => AST.isAliasDeclaration(statement) && statement.name === 'DisplayCount',
        })
        Expect.Is(displayAlias, AST.isAliasDeclaration)

        Expect(ExpressionsValidator.inferExpressionType(actionAlias.value, workspace.typir)).toBe('action')
        Expect(ExpressionsValidator.inferExpressionType(displayAlias.value, workspace.typir)).toBe('stateful number')
      },
    )
  })

  Test('keeps Typir nominal names distinct across files', async () => {
    await withTaoFiles('tao-validator-typir-names-', {
      'Entry.tao': `
        use OtherPerson from ./Other.tao
        app MyApp { view MainView }
        type Person is text
        let LocalPerson = Person "Ada"
        view MainView {
          render Text(LocalPerson)
        }
        view Text Value is text { }
      `,
      'Other.tao': `
        type Person is text
        workspace let OtherPerson = Person "Grace"
        view OtherView { }
      `,
    }, async paths => {
      const workspace = await Workspace.open(FS.dirname(paths['Entry.tao']))
      const result = await workspace.validate(paths['Entry.tao'])
      const entryAlias = result.entry.ast.statements.find(
        statement => AST.isAliasDeclaration(statement) && statement.name === 'LocalPerson',
      )
      const otherFile = result.files.find(file => file.path === paths['Other.tao'])
      const otherAlias = otherFile?.ast.statements.find(
        statement => AST.isAliasDeclaration(statement) && statement.name === 'OtherPerson',
      )
      Expect.Is(entryAlias, AST.isAliasDeclaration)
      Expect.Is(otherAlias, AST.isAliasDeclaration)

      const entryType = inferExpressionType(entryAlias.value, workspace.typir)
      const otherType = inferExpressionType(otherAlias.value, workspace.typir)
      const entryStaticType = Type.identityKey(Type.ofExpression(entryAlias.value))
      const otherStaticType = Type.identityKey(Type.ofExpression(otherAlias.value))

      Expect(entryType).toContain('/Entry.tao#Person')
      Expect(otherType).toContain('/Other.tao#Person')
      Expect(entryType).not.toBe(otherType)
      Expect(entryStaticType).toContain('/Entry.tao#Person')
      Expect(otherStaticType).toContain('/Other.tao#Person')
      Expect(entryStaticType).not.toBe(otherStaticType)
    })
  })

  Test('rejects ambiguous expected binding types', async () => {
    const ambiguousScopedParameters = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView {
        render Pair("Ada")
      }
      view Pair First is text, Second is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)
    const ambiguousArgument = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      type Base is text
      type Middle is Base
      type Leaf is Middle
      view MainView {
        render Pair(Leaf "Ada")
      }
      view Pair Base, Middle {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)
    const duplicateProperties = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      type Name is text
      type Person is {
        Name
        Name
      }
      let BadPerson = Person { Name "Ada" }
      view MainView { }
    `)
    const ambiguousProperty = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      type Base is text
      type Middle is Base
      type Leaf is Middle
      type Person is {
        Base
        Middle
      }
      let BadPerson = Person { Leaf "Ada" }
      view MainView { }
    `)
    const ambiguousParameter = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      type Base is text
      type Name is Base
      type Title is Base
      view MainView {
        render Pair(Name "Ada", Title "Grace")
      }
      view Pair Base {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)
    const ambiguousField = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      type Base is text
      type Name is Base
      type Title is Base
      type Pair is {
        Base
      }
      let BadPair = Pair { Name "Ada", Title "Grace" }
      view MainView { }
    `)

    Expect(validationErrorMessages(ambiguousScopedParameters)).toContain(
      'Render of Pair has an argument that matches multiple parameters by type: First, Second.',
    )
    Expect(validationErrorMessages(ambiguousArgument)).toContain(
      'Render of Pair has an argument that matches multiple parameters by type: Base, Middle.',
    )
    Expect(validationErrorMessages(duplicateProperties)).toContain(
      typeValidationMessages.duplicatePropertyType('Name'),
    )
    Expect(validationErrorMessages(ambiguousProperty)).toContain(
      typeValidationMessages.ambiguousProperty(['Base', 'Middle']),
    )
    Expect(validationErrorMessages(ambiguousParameter)).toContain(
      invocationValidationMessages.ambiguousParameter('Pair', 'Base'),
    )
    Expect(validationErrorMessages(ambiguousField)).toContain(typeValidationMessages.ambiguousField('Base'))
  })

  Test('rejects invalid custom type operations', async () => {
    const badCast = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      type Age is number
      let BadAge = Age "Ada"
      view MainView { }
    `)
    const missingField = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      type Name is text
      type Age is number
      type Person is {
        Name
        Age
      }
      let BadPerson = Person { Name "Ada" }
      view MainView { }
    `)
    const unmatchedField = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      type Name is text
      type Age is number
      type Person is {
        Name
        Age
      }
      let BadPerson = Person { Name "Ada", Age 40, "extra" }
      view MainView { }
    `)
    const badMember = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      type Name is text
      let DisplayName = Name "Ada"
      view MainView {
        render Text(DisplayName.First)
      }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)
    const unknownMember = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      type Name is text
      type Person is {
        Name
      }
      let DemoPerson = Person { Name "Ada" }
      view MainView {
        render Text(DemoPerson.Missing)
      }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)
    const shapelessItem = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      type Bag is item
      let BadBag = Bag { "extra" }
      view MainView {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)
    const unresolvedCast = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      let Bad = Missing "Ada"
      view MainView {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)
    const unresolvedConstructor = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      let Bad = Missing "Ada"
      view MainView {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)
    const unresolvedMember = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView {
        render Text(Missing.First)
      }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)
    const unresolvedArgument = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView {
        render Text(Missing)
      }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)
    const unresolvedProperty = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      type Name is text
      type Person is {
        Name
      }
      let BadPerson = Person { Missing }
      view MainView {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(badCast)).toContain(typeValidationMessages.constructorShape('Age', 'number'))
    Expect(validationErrorMessages(missingField)).toContain(typeValidationMessages.missingProperty('Age'))
    Expect(validationErrorMessages(unmatchedField)).toContain(typeValidationMessages.unmatchedProperty)
    Expect(validationErrorMessages(badMember)).toContain(typeValidationMessages.memberNotItem('First'))
    Expect(validationErrorMessages(unknownMember)).toContain(typeValidationMessages.unknownMember('Person', 'Missing'))
    Expect(validationErrorMessages(shapelessItem)).toContain(
      typeValidationMessages.shapelessItemConstructor('Bag'),
    )
    Expect(validationErrorMessages(unresolvedCast)).not.toContain(typeValidationMessages.typeFixIncompatible('Missing'))
    Expect(validationErrorMessages(unresolvedConstructor)).not.toContain(
      typeValidationMessages.constructorShape('Missing', 'text'),
    )
    Expect(validationErrorMessages(unresolvedMember)).not.toContain(typeValidationMessages.memberNotItem('First'))
    Expect(validationErrorMessages(unresolvedArgument)).not.toContain(
      invocationValidationMessages.unmatchedArgument('Text'),
    )
    Expect(validationErrorMessages(unresolvedArgument)).not.toContain(
      invocationValidationMessages.missingArgument('Text', 'Value'),
    )
    Expect(validationErrorMessages(unresolvedProperty)).not.toContain(typeValidationMessages.unmatchedProperty)
    Expect(validationErrorMessages(unresolvedProperty)).not.toContain(typeValidationMessages.missingProperty('Name'))
  })

  Test('rejects invalid qualified type-reference members', async () => {
    const unknownTypeMember = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      type Name is text
      type Person is {
        Name
      }
      type Bad is Person.Missing
      view MainView { }
    `)
    const nonItemTypeMember = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      type Name is text
      type Bad is Name.First
      view MainView { }
    `)
    const unknownCastMember = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      type Name is text
      type Person is {
        Name
      }
      let Bad = Person.Missing "Ada"
      view MainView { }
    `)

    Expect(validationErrorMessages(unknownTypeMember)).toContain(
      typeValidationMessages.unknownMember('Person', 'Missing'),
    )
    Expect(validationErrorMessages(nonItemTypeMember)).toContain(typeValidationMessages.memberNotItem('First'))
    Expect(validationErrorMessages(unknownCastMember)).toContain(
      typeValidationMessages.unknownMember('Person', 'Missing'),
    )
  })

  Test('resolves item-scoped property types separately from outer same-name types', async () => {
    await testValidateCode(`
      app MyApp { view MainView }
      type Name is text
      type LastName is Name
      type FullNamePerson is {
        Name is text
        LastName
      }
      let OuterName = Name "Outer"
      let FamilyName = LastName "Lovelace"
      let Ada = FullNamePerson {
        Name: "Ada",
        FamilyName
      }
      view MainView {
        render Stack(){
          Text(OuterName)
          Text(Ada.Name)
          Text(Ada.LastName)
        }
      }
      layout Stack {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)
  })

  Test('rejects top-level values for same-name scoped parameter item properties', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      type Age is number
      let OuterAge = Age 42
      view MainView {
        render Card(Card.Details { OuterAge })
      }
      view Card Details is {
        Age is number
      } {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(result)).toContain(typeValidationMessages.unmatchedProperty)
    Expect(validationErrorMessages(result)).toContain(typeValidationMessages.missingProperty('Age'))
  })

  Test('rejects cyclic type aliases without recursing forever', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      type A is B
      type B is A
      let Bad = A "value"
      view MainView { }
    `)
    const qualifiedResult = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      type A is B.C
      type B is {
        C is A
      }
      let Bad = A "value"
      view MainView { }
    `)
    const shorthandResult = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      type Person is {
        Friend
      }
      type Friend is Person
      let Bad = Person { Friend { Friend { } } }
      view MainView { }
    `)

    Expect(validationErrorMessages(result)).toContain(typeValidationMessages.cyclicType('A'))
    Expect(validationErrorMessages(result)).toContain(typeValidationMessages.cyclicType('B'))
    Expect(validationErrorMessages(qualifiedResult)).toContain(typeValidationMessages.cyclicType('A'))
    Expect(validationErrorMessages(qualifiedResult)).toContain(typeValidationMessages.cyclicType('B'))
    Expect(validationErrorMessages(shorthandResult)).toContain(typeValidationMessages.cyclicType('Person'))
    Expect(validationErrorMessages(shorthandResult)).toContain(typeValidationMessages.cyclicType('Friend'))
  })

  Test('rejects cyclic scoped parameter type declarations without recursing forever', async () => {
    const directResult = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view Cycle Self is Cycle.Self {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)
    const itemResult = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view Card Details is {
        Age is Card.Details.Age
      } {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(directResult)).toContain(typeValidationMessages.cyclicType('Cycle.Self'))
    Expect(validationErrorMessages(itemResult)).toContain(typeValidationMessages.cyclicType('Card.Details'))
  })

  Test('allows item type properties to reference sibling properties without false cycles', async () => {
    await testValidateCode(`
      app MyApp { view MainView }
      type A is {
        X is text
        Y is A.X
      }
      view MainView {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)
  })

  Test('reports constructor kind diagnostics using the expected type shape', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      type Name is text
      type Person is {
        Name
      }
      let Bad = Person "hello"
      view MainView { }
    `)

    Expect(validationErrorMessages(result)).toContain(typeValidationMessages.constructorShape('Person', 'item'))
  })

  Test('reports type diagnostics alongside structural invocation errors', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView {
        render Tile(42, "extra")
      }
      view Tile Title is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(result)).toContain(invocationValidationMessages.unmatchedArgument('Tile'))
  })

  Test('keeps cross-view values out of scope through validator diagnostics', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view Target }
      view Text Value is text { }
      view Source Secret is text { }
      view Target {
        render Text(Secret)
      }
    `)

    Expect(validationErrorMessages(result).length).toBeGreaterThan(0)
    Expect(Diagnostics.hasSource(result.diagnostics, 'validator')).toBe(true)
  })

  Test('keeps toggle targets inside their lexical state scope', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view Target }
      view Source {
        state Ready = false
        render inject ${tsFence} return null ${fence}
      }
      view Target {
        action Flip { toggle Ready }
        render inject ${tsFence} return null ${fence}
      }
    `)

    Expect(validationErrorMessages(result)).toContain(
      "Could not resolve reference to StateDeclaration named 'Ready'.",
    )
  })

  Test('case payloads resolve at their lexical depth', async () => {
    await testValidateCode(`
      data Workspaces / Workspace { Name text }
      app ScopeApp { view Main }
      view Main {
        query Workspaces { }
        render Col() {
          guard Workspaces {
            loading -> { Text("Loading") }
            error -> Message {
              loop Workspaces / Message { Text(Message.Name) }
            }
          }
          Text("Ready")
        }
      }
      layout Col { render inject ${tsFence} return null ${fence} }
      view Text Value is text { render inject ${tsFence} return null ${fence} }
    `)

    const shadowed = await testValidateCodeWithErrors(`
      data Workspaces / Workspace { Name text }
      app ScopeApp { view Main }
      view Main {
        query Workspaces { }
        render Col() {
          guard Workspaces {
            error -> Message {
              Col() {
                let Message = 5
                Text(Message)
              }
            }
          }
          Text("Ready")
        }
      }
      layout Col { render inject ${tsFence} return null ${fence} }
      view Text Value is text { render inject ${tsFence} return null ${fence} }
    `)
    Expect(validationErrorMessages(shadowed).length).toBeGreaterThan(0)
  })

  Test('reports duplicate, invalid, and payload-bearing case misuse', async () => {
    const result = await testValidateCodeWithErrors(`
      data Workspaces / Workspace { Name text }
      app CaseApp { view Main }
      view Main {
        state Draft = ""
        query Workspaces { }
        render Col() {
          guard Workspaces {
            loading -> { Text("A") }
            loading -> { Text("B") }
          }
          guard Draft {
            loading -> { Text("C") }
          }
          guard Workspaces {
            empty -> Payload { Text(Payload) }
          }
          Text(when 5 { empty -> "X" otherwise -> "Y" })
        }
      }
      layout Col { render inject ${tsFence} return null ${fence} }
      view Text Value is text { render inject ${tsFence} return null ${fence} }
    `)
    const messages = validationErrorMessages(result)
    Expect(messages).toContain(FunctionalCoreValidator.messages.duplicateCase('loading'))
    Expect(messages).toContain(FunctionalCoreValidator.messages.invalidCase('loading', 'a text subject'))
    Expect(messages).toContain(FunctionalCoreValidator.messages.invalidCasePayload)
  })
})
