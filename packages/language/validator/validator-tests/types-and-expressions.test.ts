import { Type } from '@ast-utils'
import { Workspace } from '@compiler/workspace'
import { AST } from '@parser'
import { Diagnostics, FS } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { dataValidationMessages } from '../validator-src/validators/data-validator'
import { dataWriteValidationMessages } from '../validator-src/validators/data-write-validator'
import { FunctionalCoreValidator } from '../validator-src/validators/FunctionalCoreValidator'
import { InvocationsValidator } from '../validator-src/validators/invocations-validator'
import { ReactiveParametersValidator } from '../validator-src/validators/ReactiveParametersValidator'
import { StateValidator } from '../validator-src/validators/StateValidator'
import { typeValidationMessages } from '../validator-src/validators/types-validator'
import {
  accepts,
  app,
  rejects,
  stubContainer,
  stubView,
  testValidateCodeWithErrors,
  validationErrorMessages,
  withValidationParse,
} from './test-validate'

const invocationValidationMessages = InvocationsValidator.messages

Describe('validator: types and expressions', () => {
  Test(
    'rejects direct copies of behavior-wrapper values',
    rejects(
      app(
        'let ViewCopy = copy Target\nrender Target()',
        `
        view Target() { render Empty() }
        view NavOwner(Navigation nav) { let NavCopy = copy Navigation render Empty() }
        ${stubView('Empty')}
      `,
      ),
      typeValidationMessages.copyUnsupportedValue('view'),
      typeValidationMessages.copyUnsupportedValue('nav'),
    ),
  )

  Test(
    'rejects copy parameters for behavior-wrapper values while allowing actions',
    rejects(
      app(
        'render Wrapper(Target)',
        `
        view Target() { render Empty() }
        view Wrapper(copy Value view) { render Empty() }
        ${stubView('Empty')}
      `,
      ),
      typeValidationMessages.copyUnsupportedValue('view'),
    ),
  )

  Test(
    'allows direct copies of action atoms',
    accepts(app('action Save() { }\nlet Snapshot = copy Save\nrender Empty()', stubView('Empty'))),
  )

  Test(
    'accepts copied projected inputs and bulk data updates',
    accepts(`
      data Documents / Document { Title text, Body text, Owner text, CreatedAt time }
      type DocumentInput is Document { Title, Body }
      type DraftFields is { Title text, Body text }
      app EditorApp { view Main }
      view Main() { render Empty() }
      view Editor(Document) {
        state Input = copy Document as DocumentInput
        let Draft = DraftFields { Title: "Draft", Body: "" }
        state FromDraft = copy Draft as DocumentInput
        let DraftInput = DocumentInput { Title: "Draft", Body: "" }
        action Save() { update Document with Input }
        render Empty()
      }
      ${stubView('Empty')}
    `),
  )

  Test(
    'accepts entity write-status members',
    accepts(`
      data Documents / Document { Title text }
      app EditorApp { view Main }
      view Main() { render Empty() }
      view Editor(Document) {
        let Queued = Document.WritesQueued
        let Failed = Document.WritesFailed
        let Error = Document.WriteError
        let CanRetry = Document.CanRetryWrites
        render Empty()
      }
      ${stubView('Empty')}
    `),
  )

  Test(
    'types the completeness members that required derives on rows and projections',
    accepts(`
      data Documents / Document { Title text (required "Name this document"), Body text }
      type DocumentInput is Document { Title, Body }
      type BodyInput is Document without { Title }
      app EditorApp { view Main }
      view Main() { render Empty() }
      view Editor(Document) {
        state Input = copy Document as DocumentInput
        state Body = copy Document as BodyInput
        let RowIncomplete is boolean = Document.Incomplete
        let RowProblems is list of text = Document.Problems
        let InputIncomplete is boolean = Input.Incomplete
        let InputProblems is list of text = Input.Problems
        let BodyIncomplete is boolean = Body.Incomplete
        render Empty()
      }
      ${stubView('Empty')}
    `),
  )

  Test(
    'offers completeness members only on rows and projections, never on a plain item',
    rejects(
      `
        type Draft is { Title text }
        app EditorApp { view Main }
        view Main() {
          let Value = Draft { Title: "" }
          let Missing = Value.Problems
          render Empty()
        }
        ${stubView('Empty')}
      `,
      typeValidationMessages.unknownMember('Draft', 'Problems'),
    ),
  )

  Test(
    'reserves the completeness member names and rejects a repeated required',
    rejects(
      `
        data Documents / Document {
          Problems text,
          Incomplete text,
          Title text (required "Name it", required "Name it again")
        }
      `,
      dataValidationMessages.reservedField('Document', 'Problems'),
      dataValidationMessages.reservedField('Document', 'Incomplete'),
      dataValidationMessages.duplicateModifier('Title', 'required'),
    ),
  )

  Test(
    'rejects writes to derived completeness members and binding one as writable storage',
    rejects(
      `
        data Notes / Note { Title text (required "Name it") }
        type NoteInput is Note { Title }
        app EditorApp { view Main }
        view Flip(Value boolean) {
          action Go() { toggle Value }
          render Empty()
        }
        view Main() {
          state Input = NoteInput { Title: "" }
          action Break() {
            set Input.Incomplete = true
            toggle Input.Incomplete
          }
          render Flip(Value: Input.Incomplete)
        }
        ${stubView('Empty')}
      `,
      StateValidator.messages.derivedMemberWrite('Input.Incomplete'),
      ReactiveParametersValidator.messages.readonlyArgument('Value'),
    ),
  )

  Test('reports a derived-member write once, without the generic writable-path diagnostic', async () => {
    const result = await testValidateCodeWithErrors(`
      data Notes / Note { Title text (required "Name it") }
      type NoteInput is Note { Title }
      app EditorApp { view Main }
      view Main() { render Empty() }
      view Editor(Input NoteInput) {
        action Break() { set Input.Incomplete = true }
        render Empty()
      }
      ${stubView('Empty')}
    `)

    Expect(validationErrorMessages(result)).toEqual([StateValidator.messages.derivedMemberWrite('Input.Incomplete')])
  })

  Test(
    'accepts a create from a projection that covers every field a create must supply',
    accepts(`
      data Workspaces / Workspace { Name text (required "Name this workspace"), Pinned yes / no }
      type WorkspaceInput is Workspace { Name }
      app EditorApp { view Main }
      view Main() {
        state Input = WorkspaceInput { Name: "" }
        action Add() { create Workspace with Input }
        render Empty()
      }
      ${stubView('Empty')}
    `),
  )

  Test(
    'rejects a create from another entity, a to-many field, or a projection missing a needed field',
    rejects(
      `
        data Workspaces / Workspace { Name text, Motto text, Documents (owned) }
        data Documents / Document { Title text, Workspace }
        type NameOnly is Workspace { Name }
        type WithDocuments is Workspace { Name, Motto, Documents }
        type TitleOnly is Document { Title }
        app EditorApp { view Main }
        view Main() {
          state Short = NameOnly { Name: "" }
          state Listed = WithDocuments { Name: "", Motto: "" }
          state Other = TitleOnly { Title: "" }
          action Add() {
            create Workspace with Short
            create Workspace with Listed
            create Workspace with Other
          }
          render Empty()
        }
        ${stubView('Empty')}
      `,
      dataWriteValidationMessages.createInputMissing('Workspace', 'Motto'),
      dataWriteValidationMessages.createInputField('Workspace', 'Documents'),
      dataWriteValidationMessages.createInput('Workspace'),
    ),
  )

  Test(
    'rejects invalid projected input fields and bulk updates from another entity',
    rejects(
      `
        data Documents / Document { Title text }
        data Accounts / Account { Name text }
        type BadInput is Document { Missing, Missing }
        type AccountInput is Account { Name }
      app EditorApp { view Main }
      view Main() { render Empty() }
        view Editor(Document, Account) {
          state Input = copy Account as AccountInput
          action Save() { update Document with Input }
          render Empty()
        }
        ${stubView('Empty')}
      `,
      typeValidationMessages.projectedItemField('Document', 'Missing'),
      typeValidationMessages.duplicateProjectedItemField('Missing'),
      "Update of 'Document' expects an input item copied from that entity.",
    ),
  )

  Test(
    'rejects incompatible copy targets and projected input widening',
    rejects(
      `
        data Documents / Document { Title text, Body text }
        type DocumentInput is Document { Title, Body }
        type TitleInput is Document { Title }
        app EditorApp { view Main }
        view Main() { render Empty() }
        view Editor(Document) {
          state Scalar = copy "bad" as number
          state Narrow = copy Document as TitleInput
          state Wide = copy Narrow as DocumentInput
          render Empty()
        }
        ${stubView('Empty')}
      `,
      typeValidationMessages.typeFixIncompatible('number'),
      typeValidationMessages.copyInputField('DocumentInput', 'Body'),
    ),
  )

  Test(
    'rejects bulk updates that select an inverse relation',
    rejects(
      `
        data Parents / Parent { Children (owned) }
        data Children / Child { Parent }
        type ParentInput is Parent { Children }
        app EditorApp { view Main }
        view Main() { render Empty() }
        view Editor(Parent) {
          state Input = copy Parent as ParentInput
          action Save() { update Parent with Input }
          render Empty()
        }
        ${stubView('Empty')}
      `,
      dataWriteValidationMessages.updateInputField('Parent', 'Children'),
    ),
  )

  Test(
    'rejects retry without a data row target',
    rejects(
      app(
        'let Target = 1 action Save() { retry Target } render Empty()',
        stubView('Empty'),
      ),
      dataWriteValidationMessages.rowTarget('retry'),
    ),
  )

  Test('infers primitive expression types', async () => {
    await withValidationParse(
      app('', 'let Greeting = "Hello" let Count = 3'),
      ({ result }) => {
        const aliases = result.entry.ast.statements.filter(AST.isAliasDeclaration)

        Expect(expressionTypeName(aliases[0]!.value)).toBe('text')
        Expect(expressionTypeName(aliases[1]!.value)).toBe('number')
      },
    )
  })

  Test('infers action and state-backed expression types', async () => {
    await withValidationParse(
      app(
        'state Count = 3 let DisplayCount = Count render Text("hi")',
        `let SaveAction = action { } ${stubView('Text', 'Value text')}`,
      ),
      ({ result }) => {
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

        Expect(expressionTypeName(actionAlias.value)).toBe('action()')
        Expect(expressionTypeName(displayAlias.value)).toBe('number')
      },
    )
  })

  Test('keeps nominal type identities distinct across files', async () => {
    await withTaoFiles('tao-validator-nominal-names-', {
      'Entry.tao': `
        use OtherPerson from ./Other.tao
        app MyApp { view MainView }
        type Person is text
        let LocalPerson = Person "Ada"
        view MainView() { render Text(LocalPerson) }
        ${stubView('Text', 'Value text')}
      `,
      'Other.tao': `
        type Person is text
        workspace let OtherPerson = Person "Grace"
        view OtherView() { }
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

      const entryStaticType = Type.identityKey(Type.ofExpression(entryAlias.value))
      const otherStaticType = Type.identityKey(Type.ofExpression(otherAlias.value))

      Expect(entryStaticType).toContain('/Entry.tao#Person')
      Expect(otherStaticType).toContain('/Other.tao#Person')
      Expect(entryStaticType).not.toBe(otherStaticType)
      Expect(expressionTypeName(entryAlias.value)).toBe('Person')
      Expect(expressionTypeName(otherAlias.value)).toBe('Person')
    })
  })

  Test(
    'accepts defaulted and filled declaration slots without requiring constructor values',
    accepts(typeApp(
      `
        type Document is {
          Name text,
          Title text is "Untitled",
          Kind is "document",
        }
        let Draft = Document { Name "Roadmap" }
      `,
      'render Empty()',
      stubView('Empty'),
    )),
  )

  Test(
    'rejects a declaration slot default with the wrong type',
    rejects(
      typeApp('type Document is { Count number is "many" }'),
      typeValidationMessages.slotDefaultType('Count', 'number', 'text'),
    ),
  )

  Test(
    'accepts derived slots, same-name bare construction, and generic immutable value patches',
    accepts(typeApp(
      `
        type Person is { Name text, Role text is "member" }
        type Admin is Person with { Role is "admin", Access number is 1 }
        let Admin = { Name "the Developer" }
        let Renamed = Admin with { Name "Grace", Access 2 }
      `,
      'render Text(Renamed.Name)',
      stubView('Text', 'Value text'),
    )),
  )

  Test(
    'rejects derived types that reopen filled or defaulted slots',
    rejects(
      typeApp(`
        type Fixed is { Kind is "fixed" }
        type Opened is Fixed with { Kind text }
        type Defaulted is { Label text is "default" }
        type ReopenedDefault is Defaulted with { Label text }
      `),
      typeValidationMessages.derivedSlotReopened('Kind'),
    ),
  )

  Test(
    'rejects value derivation that changes a filled slot',
    rejects(
      typeApp(`
        type Person is { Name text, Kind is "person" }
        let Person = { Name "the Developer" }
        let Invalid = Person with { Kind "admin" }
      `),
      typeValidationMessages.filledProperty('Kind'),
    ),
  )

  const ambiguousBindingCases: ReadonlyArray<readonly [name: string, source: string, message: string]> = [
    [
      'arguments matching multiple same-typed parameters',
      app('render Pair("Ada")', stubView('Pair', 'First text, Second text')),
      'Render of Pair has an argument that matches multiple parameters by type: First, Second.',
    ],
    [
      'arguments matching multiple nominal ancestors',
      typeApp(
        'type Base is text type Middle is Base type Leaf is Middle',
        'render Pair(Leaf "Ada")',
        stubView('Pair', 'Base, Middle'),
      ),
      'Render of Pair has an argument that matches multiple parameters by type: Base, Middle.',
    ],
    [
      'duplicate item property types',
      typeApp('type Name is text type Person is { Name, Name } let BadPerson = Person { Name "Ada" }'),
      typeValidationMessages.duplicatePropertyType('Name'),
    ],
    [
      'item fields matching multiple nominal ancestors',
      typeApp(`
        type Base is text
        type Middle is Base
        type Leaf is Middle
        type Person is { Base, Middle }
        let BadPerson = Person { Leaf "Ada" }
      `),
      typeValidationMessages.ambiguousProperty(['Base', 'Middle']),
    ],
    [
      'parameters matched by multiple arguments',
      typeApp(
        'type Base is text type Name is Base type Title is Base',
        'render Pair(Name "Ada", Title "Grace")',
        stubView('Pair', 'Base'),
      ),
      invocationValidationMessages.ambiguousParameter('Pair', 'Base'),
    ],
    [
      'item properties matched by multiple fields',
      typeApp(`
        type Base is text
        type Name is Base
        type Title is Base
        type Pair is { Base }
        let BadPair = Pair { Name "Ada", Title "Grace" }
      `),
      typeValidationMessages.ambiguousField('Base'),
    ],
  ]

  for (const [name, source, message] of ambiguousBindingCases) {
    Test(`rejects ambiguous ${name}`, rejects(source, message))
  }

  const invalidTypeCases: ReadonlyArray<readonly [name: string, source: string, message: string]> = [
    [
      'primitive constructors with the wrong shape',
      typeApp('type Age is number let BadAge = Age "Ada"'),
      typeValidationMessages.constructorShape('Age', 'number'),
    ],
    [
      'item constructors with missing properties',
      typeApp(`
        type Name is text
        type Age is number
        type Person is { Name, Age }
        let BadPerson = Person { Name "Ada" }
      `),
      typeValidationMessages.missingProperty('Age'),
    ],
    [
      'item constructors with unmatched fields',
      typeApp(`
        type Name is text
        type Age is number
        type Person is { Name, Age }
        let BadPerson = Person { Name "Ada", Age 40, "extra" }
      `),
      typeValidationMessages.unmatchedProperty,
    ],
    [
      'member access on non-item nominal values',
      typeApp(
        'type Name is text let DisplayName = Name "Ada"',
        'render Text(DisplayName.First)',
        stubView('Text', 'Value text'),
      ),
      typeValidationMessages.memberNotItem('First'),
    ],
    [
      'unknown item members',
      typeApp(
        'type Name is text type Person is { Name } let DemoPerson = Person { Name "Ada" }',
        'render Text(DemoPerson.Missing)',
        stubView('Text', 'Value text'),
      ),
      typeValidationMessages.unknownMember('Person', 'Missing'),
    ],
    [
      'constructors for shapeless item aliases',
      typeApp('type Bag is item let BadBag = Bag { "extra" }'),
      typeValidationMessages.shapelessItemConstructor('Bag'),
    ],
  ]

  for (const [name, source, message] of invalidTypeCases) {
    Test(`rejects ${name}`, rejects(source, message))
  }

  const cascadeSuppressionCases: ReadonlyArray<
    readonly [name: string, source: string, unresolvedMessage: string, suppressedMessages: readonly string[]]
  > = [
    [
      'unresolved constructors',
      typeApp('let Bad = Missing "Ada"'),
      "No type named 'Missing' is in scope.",
      [
        typeValidationMessages.typeFixIncompatible('Missing'),
        typeValidationMessages.constructorShape('Missing', 'text'),
      ],
    ],
    [
      'member access on unresolved values',
      app('render Text(Missing.First)', stubView('Text', 'Value text')),
      "No value named 'Missing' is in scope.",
      [typeValidationMessages.memberNotItem('First')],
    ],
    [
      'unresolved invocation arguments',
      app('render Text(Missing)', stubView('Text', 'Value text')),
      "No value named 'Missing' is in scope.",
      [
        invocationValidationMessages.unmatchedArgument('Text'),
        invocationValidationMessages.missingArgument('Text', 'Value'),
      ],
    ],
    [
      'unresolved item fields',
      typeApp('type Name is text type Person is { Name } let BadPerson = Person { Missing }'),
      "No data entity or value named 'Missing' is in scope.",
      [typeValidationMessages.unmatchedProperty, typeValidationMessages.missingProperty('Name')],
    ],
  ]

  for (const [name, source, unresolvedMessage, suppressedMessages] of cascadeSuppressionCases) {
    Test(
      `does not cascade type diagnostics from ${name}`,
      rejectsWithout(source, unresolvedMessage, ...suppressedMessages),
    )
  }

  const qualifiedMemberCases: ReadonlyArray<readonly [name: string, source: string, message: string]> = [
    [
      'unknown type-reference members',
      typeApp('type Name is text type Person is { Name } type Bad is Person.Missing'),
      typeValidationMessages.unknownMember('Person', 'Missing'),
    ],
    [
      'qualified members of non-item types',
      typeApp('type Name is text type Bad is Name.First'),
      typeValidationMessages.memberNotItem('First'),
    ],
    [
      'constructors for unknown qualified members',
      typeApp('type Name is text type Person is { Name } let Bad = Person.Missing "Ada"'),
      typeValidationMessages.unknownMember('Person', 'Missing'),
    ],
  ]

  for (const [name, source, message] of qualifiedMemberCases) {
    Test(`rejects ${name}`, rejects(source, message))
  }

  Test(
    'resolves item-scoped property types separately from outer same-name types',
    accepts(typeApp(
      `
        type Name is text
        type LastName is Name
        type FullNamePerson is { Name text, LastName }
        let OuterName = Name "Outer"
        let FamilyName = LastName "Lovelace"
        let Ada = FullNamePerson { Name: "Ada", FamilyName }
      `,
      'render Stack() { Text(OuterName) Text(Ada.Name) Text(Ada.LastName) }',
      `${stubContainer('Stack')}${stubView('Text', 'Value text')}`,
    )),
  )

  Test(
    'rejects top-level values for same-name scoped parameter item properties',
    rejects(
      typeApp(
        'type Age is number let OuterAge = Age 42',
        'render Card(Card.Details { OuterAge })',
        stubView('Card', 'Details { Age number }'),
      ),
      typeValidationMessages.unmatchedProperty,
      typeValidationMessages.missingProperty('Age'),
    ),
  )

  const aliasCycleCases: ReadonlyArray<readonly [name: string, source: string, messages: readonly string[]]> = [
    [
      'direct aliases',
      typeApp('type A is B type B is A let Bad = A "value"'),
      [typeValidationMessages.cyclicType('A'), typeValidationMessages.cyclicType('B')],
    ],
    [
      'qualified aliases',
      typeApp('type A is B.C type B is { C A } let Bad = A "value"'),
      [typeValidationMessages.cyclicType('A'), typeValidationMessages.cyclicType('B')],
    ],
    [
      'shorthand item properties',
      typeApp('type Person is { Friend } type Friend is Person let Bad = Person { Friend { Friend { } } }'),
      [typeValidationMessages.cyclicType('Person'), typeValidationMessages.cyclicType('Friend')],
    ],
  ]

  for (const [name, source, messages] of aliasCycleCases) {
    Test(`rejects cyclic ${name} without recursing forever`, rejects(source, ...messages))
  }

  const scopedCycleCases: ReadonlyArray<readonly [name: string, source: string, message: string]> = [
    [
      'direct parameter types',
      app('render Empty()', `${stubView('Empty')}${stubView('Cycle', 'Self Cycle.Self')}`),
      typeValidationMessages.cyclicType('Cycle.Self'),
    ],
    [
      'parameter item property types',
      app(
        'render Empty()',
        `${stubView('Empty')}${stubView('Card', 'Details { Age Card.Details.Age }')}`,
      ),
      typeValidationMessages.cyclicType('Card.Details'),
    ],
  ]

  for (const [name, source, message] of scopedCycleCases) {
    Test(`rejects cyclic scoped ${name} without recursing forever`, rejects(source, message))
  }

  Test(
    'allows item type properties to reference sibling properties without false cycles',
    accepts(typeApp('type A is { X text, Y A.X }', 'render Empty()', stubView('Empty'))),
  )

  Test(
    'reports constructor kind diagnostics using the expected type shape',
    rejects(
      typeApp('type Name is text type Person is { Name } let Bad = Person "hello"'),
      typeValidationMessages.constructorShape('Person', 'item'),
    ),
  )

  Test(
    'reports type diagnostics alongside structural invocation errors',
    rejects(
      app('render Tile(42, "extra")', stubView('Tile', 'Title text')),
      invocationValidationMessages.unmatchedArgument('Tile'),
    ),
  )

  Test('keeps cross-view values out of scope with a located linker diagnostic', async () => {
    const message = "No value named 'Secret' is in scope."
    const result = await testValidateCodeWithErrors(`
      app MyApp { view Target }
      ${stubView('Text', 'Value text')}
      ${stubView('Source', 'Secret text')}
      view Target() { render Text(Secret) }
    `)

    const diagnostic = result.diagnostics.find(candidate => candidate.message === message)
    Expect(validationErrorMessages(result)).toEqual([message])
    Expect(diagnostic?.range).toBeDefined()
    Expect(Diagnostics.hasSource(result.diagnostics, 'linker')).toBe(true)
  })

  Test(
    'keeps toggle targets inside their lexical state scope',
    rejects(
      `
      app MyApp { view Target }
      view Source() { state Ready = false render Empty() }
      view Target() { action Flip() { toggle Ready } render Empty() }
      ${stubView('Empty')}
    `,
      "No value named 'Ready' is in scope.",
    ),
  )

  Test(
    'resolves case payloads at their lexical depth',
    accepts(caseScopeApp(`
      guard Workspaces {
        loading -> { Text("Loading") }
        error -> Message { loop Workspaces / Message { Text(Message.Name) } }
      }
      Text("Ready")
    `)),
  )

  Test(
    'resolves a shadowing alias instead of an outer case payload',
    rejects(
      caseScopeApp(`
        guard Workspaces {
          error -> Message { Col() { let Message = 5 Text(Message) } }
        }
        Text("Ready")
      `),
      invocationValidationMessages.unmatchedArgument('Text'),
    ),
  )

  const invalidCaseCases: ReadonlyArray<readonly [name: string, source: string, message: string]> = [
    [
      'duplicate cases',
      caseScopeApp(`
        guard Workspaces {
          loading -> { Text("A") }
          loading -> { Text("B") }
        }
      `),
      FunctionalCoreValidator.messages.duplicateCase('loading'),
    ],
    [
      'cases unsupported by the subject type',
      caseScopeApp('guard Draft { loading -> { Text("C") } }', 'state Draft = ""'),
      FunctionalCoreValidator.messages.invalidCase('loading', 'a text subject'),
    ],
    [
      'payloads on payload-free cases',
      caseScopeApp('guard Workspaces { empty -> Payload { Text(Payload) } }'),
      FunctionalCoreValidator.messages.invalidCasePayload,
    ],
  ]

  for (const [name, source, message] of invalidCaseCases) {
    Test(`rejects ${name}`, rejects(source, message))
  }
})

function expressionTypeName(expression: AST.Expression): string {
  return Type.displayName(Type.ofExpression(expression))
}

function typeApp(declarations: string, mainBody = '', fixtures = ''): string {
  return app(mainBody, `${declarations} ${fixtures}`)
}

function rejectsWithout(
  source: string,
  expectedMessage: string,
  ...unexpectedMessages: readonly string[]
): () => Promise<void> {
  return async () => {
    const result = await testValidateCodeWithErrors(source)
    const messages = validationErrorMessages(result)
    Expect(messages).toContain(expectedMessage)
    for (const message of unexpectedMessages) {
      Expect(messages).not.toContain(message)
    }
  }
}

function caseScopeApp(body: string, declarations = ''): string {
  return `
    data Workspaces / Workspace { Name text }
    app ScopeApp { view Main }
    view Main() {
      ${declarations}
      query Workspaces = Workspaces with { }
      render Col() { ${body} }
    }
    ${stubContainer('Col')}
    ${stubView('Text', 'Value text')}
  `
}
