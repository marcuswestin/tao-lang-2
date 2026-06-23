import { Packages, Type } from '@ast-utils'
import { AST, Langium, Parser } from '@parser'
import { Diagnostics, FS, Text } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { ValidationResult } from '@validator'
import { Workspace } from '@workspace'
import { ActionsValidator } from '../validator-src/ActionsValidator'
import { AliasesValidator } from '../validator-src/aliases-validator'
import { AppValidator } from '../validator-src/app-validator'
import { useValidationCodes } from '../validator-src/diagnostic-codes'
import { ExpressionsValidator } from '../validator-src/expressions-validator'
import { injectionValidationMessages } from '../validator-src/injections-validator'
import { InvocationsValidator } from '../validator-src/invocations-validator'
import { LayoutValidator } from '../validator-src/layout-validator'
import { projectValidationMessages } from '../validator-src/project-validator'
import { StateValidator } from '../validator-src/StateValidator'
import { typeValidationMessages } from '../validator-src/types-validator'
import { useValidationMessages, validateVisibleDeclarations } from '../validator-src/use-validator'
import { Validation } from '../validator-src/validation'
import Validator from '../validator-src/validator'
import { ViewsValidator } from '../validator-src/views-validator'
import { testValidateCode, testValidateCodeWithErrors, validationErrorMessages } from './test-validate'

const kitchenSinkPath = FS.repoPath('Apps/Kitchen Sink/Kitchen Sink.tao')
const typeSystemTestsPath = FS.repoPath('Apps/Test Apps/Type System Tests/Type System Tests.tao')
const runtimeStdlibTestsPath = FS.repoPath('Apps/Test Apps/Runtime Stdlib Tests/Runtime Stdlib Tests.tao')
const stateActionMvpPath = FS.repoPath('Apps/Test Apps/State Action MVP/State Action MVP.tao')
const tsFence = '```ts'
const fence = '```'
const aliasValidationMessages = AliasesValidator.messages
const inferExpressionType = ExpressionsValidator.inferExpressionType
const invocationValidationMessages = InvocationsValidator.messages
const layoutValidationMessages = LayoutValidator.messages

async function withValidationParse<T>(
  source: string,
  testFunction: (fixture: {
    result: ValidationResult
    workspace: Workspace
  }) => T | Promise<T>,
): Promise<T> {
  const rootDir = await FS.mkTmpDir(FS.resolvePath('tao-validator-parse-', { cwd: FS.tmpdir() }))
  try {
    const sourcePath = FS.resolvePath('Source.tao', { cwd: rootDir })
    await FS.writeText(sourcePath, Text.stripIndent(source))
    const workspace = await Workspace.open(rootDir)
    const validated = await workspace.validate(sourcePath)
    return await testFunction({ result: validated, workspace })
  } finally {
    await FS.remove(rootDir)
  }
}

type ValidatedFiles = Awaited<ReturnType<typeof Workspace.validate>>

async function withValidatedFiles<
  const Files extends Record<string, string>,
  EntryFile extends keyof Files & string,
>(
  entryFile: EntryFile,
  files: Files,
  testFunction: (validated: ValidatedFiles) => Promise<void> | void,
): Promise<void> {
  await withTaoFiles('tao-validator-', files, async paths => {
    await testFunction(await Workspace.validate(paths[entryFile]))
  })
}

Describe('Tao validator structural diagnostics', () => {
  Test('validates the current Kitchen Sink app', async () => {
    const result = await Workspace.validate(kitchenSinkPath)

    Expect(validationErrorMessages(result)).toEqual([])
  })

  Test('validates the Type System Tests app', async () => {
    const result = await Workspace.validate(typeSystemTestsPath)

    Expect(validationErrorMessages(result)).toEqual([])
  })

  Test('validates the Runtime Stdlib Tests app', async () => {
    const result = await Workspace.validate(runtimeStdlibTestsPath)

    Expect(validationErrorMessages(result)).toEqual([])
  })

  Test('validates the State Action MVP app', async () => {
    const result = await Workspace.validate(stateActionMvpPath)

    Expect(validationErrorMessages(result)).toEqual([])
  })

  Test('validates an existing parser result', async () => {
    await withValidationParse(
      `
      app MyApp { view MainView }
      view MainView {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `,
      ({ result }) => {
        Expect(validationErrorMessages(result)).toEqual([])
      },
    )
  })

  Test('does not report duplicate visible declarations for repeated LSP document instances', async () => {
    const parserContext = Parser.createContext()
    const uri = Langium.URI.file('/__tao__/Views.tao')
    const documentOne = parserContext.services.shared.workspace.LangiumDocumentFactory.fromString<AST.TaoFile>(
      'publish layout Box { }',
      uri,
    )
    const documentTwo = parserContext.services.shared.workspace.LangiumDocumentFactory.fromString<AST.TaoFile>(
      'publish layout Box { }',
      uri,
    )
    const diagnostics = Validation.collectDiagnostics()
    const packagesContext = await Packages.createContext('/__tao__')
    const ctx = Validation.createContext(diagnostics.accept, {
      entryFilePath: uri.path,
      packagesContext,
      typir: {} as any,
      workspaceFiles: [
        documentOne.parseResult.value!,
        documentTwo.parseResult.value!,
      ],
    })

    validateVisibleDeclarations(ctx, documentOne.parseResult.value!)

    Expect(diagnostics.diagnostics).toEqual([])
  })

  Test('returns parser diagnostics without running structural checks on syntax errors', async () => {
    const result = await testValidateCodeWithErrors('view Broken { render }')

    Expect(Diagnostics.hasSource(result.diagnostics, 'parser')).toBe(true)
    Expect(Diagnostics.hasSource(result.diagnostics, 'validator')).toBe(false)
  })

  Test('exposes Typir services for primitive expression inference', async () => {
    await withValidationParse(
      `
      app MyApp { view MainView }
      alias Greeting = "Hello"
      alias Count = 3
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
      alias SaveAction = action { }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        state Count = 3
        alias DisplayCount = Count
        render Text "hi"
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
        alias LocalPerson = Person "Ada"
        view MainView {
          render Text LocalPerson
        }
        view Text Value is text { }
      `,
      'Other.tao': `
        type Person is text
        project alias OtherPerson = Person "Grace"
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

  Test('rejects unsupported top-level statements', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      render MainView
      view MainView { }
    `)

    Expect(validationErrorMessages(result)).toContain(AppValidator.messages.topLevel)
  })

  Test('rejects file-level state declarations', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      state Count = 0
      view MainView { }
    `)

    Expect(validationErrorMessages(result)).toContain(AppValidator.messages.topLevel)
  })

  Test('requires at most one app declaration', async () => {
    await testValidateCode(`
      view MainView {
        render inject \`\`\`ts
          return null
        \`\`\`
      }
    `)
    const duplicate = await testValidateCodeWithErrors(`
      app First { view MainView }
      app Second { view MainView }
      view MainView { }
    `)

    Expect(validationErrorMessages(duplicate)).toContain(AppValidator.messages.appCount(2))
  })

  Test('requires exactly one root view in app blocks', async () => {
    const missing = await testValidateCodeWithErrors(`
      app MyApp { }
      view MainView { }
    `)
    const duplicate = await testValidateCodeWithErrors(`
      app MyApp {
        view MainView
        view OtherView
      }
      view MainView { }
      view OtherView { }
    `)

    Expect(validationErrorMessages(missing)).toContain(AppValidator.messages.appRootCount('MyApp', 0))
    Expect(validationErrorMessages(duplicate)).toContain(AppValidator.messages.appRootCount('MyApp', 2))
  })

  Test('rejects app root view declarations with parameters', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView Label is text {
        render Text Label
      }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(result)).toContain(AppValidator.messages.rootViewParameters('MyApp', 'MainView'))
  })

  Test('rejects non-root-view statements in app blocks', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp {
        alias Greeting = "Hello"
        view MainView
      }
      view MainView { }
    `)

    Expect(validationErrorMessages(result)).toContain(AppValidator.messages.appBlock('MyApp'))
  })

  Test('rejects unsupported view body statements', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView {
        view Nested { }
      }
    `)

    Expect(validationErrorMessages(result)).toContain(ViewsValidator.messages.viewBody)
  })

  Test('allows state and action declarations before a view render', async () => {
    await testValidateCode(`
      app MyApp { view MainView }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        state Count = 0
        action AddOne {
          set Count += 1
        }
        render Text "ok"
      }
    `)
  })

  Test('rejects state and action declarations in layouts and render blocks', async () => {
    const layoutResult = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView {
        render Stack
      }
      layout Stack {
        state Count = 0
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)
    const renderBlockResult = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Text "hi" {
          action AddOne { }
        }
      }
    `)

    Expect(validationErrorMessages(layoutResult)).toContain(ViewsValidator.messages.layoutBody)
    Expect(validationErrorMessages(renderBlockResult)).toContain(ViewsValidator.messages.renderBlock)
  })

  Test('validates set, do, parameters is action, and stateful render arguments', async () => {
    await testValidateCode(`
      app MyApp { view MainView }
      view Button Title is text, Action is action {
        render inject Title ${tsFence}
          return null
        ${fence}
      }
      view Number Value is number {
        render inject Value ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        state Count = 0
        alias DisplayCount = Count
        action AddStep Step is number {
          set Count += Step
        }
        action AddFive {
          do AddStep 5
        }
        render Button "Add", AddFive {
          Number DisplayCount
          Button "Reset", action {
            set Count = 0
          }
        }
      }
    `)
  })

  Test('allows file-level actions and forward action references inside action bodies', async () => {
    await testValidateCode(`
      app MyApp { view MainView }
      action SharedAction { }
      view Button Title is text, Action is action {
        render inject Title ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        state Count = 0
        action AddTwo {
          do AddOne
          do AddOne
        }
        action AddOne {
          set Count += 1
        }
        render Button "Shared", SharedAction
      }
    `)
  })

  Test('allows inline action bodies to reference later local actions', async () => {
    await testValidateCode(`
      app MyApp { view MainView }
      view Button Title is text, Action is action {
        render inject Title ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        alias LaterClick = action {
          do AddOne
        }
        action AddOne { }
        render Button "Add", LaterClick
      }
    `)
  })

  Test('rejects local alias initializers that reference later local actions directly', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        alias LaterClick = AddOne
        action AddOne { }
        render Text "hi"
      }
    `)

    Expect(validationErrorMessages(result)).toContain(
      AliasesValidator.messages.aliasUsedBeforeDeclaration('LaterClick', 'AddOne'),
    )
  })

  Test('allows local state and alias initializers to reference later file-level values', async () => {
    await testValidateCode(`
      app MyApp { view MainView }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        state Count = InitialCount
        alias Greeting = LateGreeting
        alias Save = SharedAction
        render Text Greeting
      }
      alias InitialCount = 1
      alias LateGreeting = "Hello"
      action SharedAction { }
    `)
  })

  Test('reports action arity and action argument type mismatches', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        state Count = 0
        action AddStep Step is number {
          set Count += Step
        }
        action DynamicArgs {
          do action { } 1
        }
        action Missing {
          do AddStep
        }
        action Extra {
          do AddStep 1, 2
        }
        action WrongType {
          do AddStep "one"
        }
        render Text "hi"
      }
    `)

    Expect(validationErrorMessages(result)).toContain(ActionsValidator.messages.dynamicActionArguments)
    Expect(validationErrorMessages(result)).toContain(ActionsValidator.messages.missingArgument('AddStep', 'Step'))
    Expect(validationErrorMessages(result)).toContain(ActionsValidator.messages.unmatchedArgument('AddStep'))
  })

  Test('reports action duplicate and ambiguous type binding diagnostics', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      type Base is text
      type Middle is Base
      type Leaf is Middle
      type Name is Base
      type Title is Base
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        action AddStep Step is number { }
        action AmbiguousScoped First is number, Second is number { }
        action AmbiguousArgument Base, Middle { }
        action AmbiguousParameter Base { }
        action CallActions {
          do AddStep 1, 2
          do AmbiguousScoped 1
          do AmbiguousArgument Leaf: "x"
          do AmbiguousParameter Name: "x", Title: "y"
        }
        render Text "hi"
      }
    `)

    Expect(validationErrorMessages(result)).toContain(ActionsValidator.messages.duplicateArgumentType('AddStep'))
    Expect(validationErrorMessages(result)).toContain(
      'Action AmbiguousScoped has an argument that matches multiple parameters by type: First, Second.',
    )
    Expect(validationErrorMessages(result)).toContain(
      'Action AmbiguousArgument has an argument that matches multiple parameters by type: Base, Middle.',
    )
    Expect(validationErrorMessages(result)).toContain(
      ActionsValidator.messages.ambiguousParameter('AmbiguousParameter', 'Base'),
    )
  })

  Test('validates set and member access for item-valued state', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      type Name is text
      type Person is {
        Name
      }
      view MainView {
        state Current = Person { Name "Ada" }
        action Break {
          set Current = "not a person"
        }
        render Text Current.Missing
      }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(result)).toContain(
      StateValidator.messages.setTypeMismatch('Current', 'Person', 'text'),
    )
    Expect(validationErrorMessages(result)).toContain(typeValidationMessages.unknownMember('Person', 'Missing'))
  })

  Test('allows action arguments through unambiguous nominal lineage', async () => {
    await testValidateCode(`
      app MyApp { view MainView }
      type Base is text
      type Leaf is Base
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        action Save Base { }
        action CallSave {
          do Save Leaf: "x"
        }
        render Text "hi"
      }
    `)
  })

  Test('allows do targets through action aliases', async () => {
    await testValidateCode(`
      app MyApp { view MainView }
      alias Save = action { }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        action Run {
          do Save
        }
        render Text "hi"
      }
    `)
  })

  Test('does not report dynamic action arguments for unresolved named do targets', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        action CallMissing {
          do Missing 1
        }
        render Text "hi"
      }
    `)

    Expect(validationErrorMessages(result)).not.toContain(ActionsValidator.messages.dynamicActionArguments)
  })

  Test('reports dynamic action arguments for action-typed parameters', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Wrapper action { }
      }
      view Wrapper Callback is action {
        action CallCallback {
          do Callback 1
        }
        render Text "hi"
      }
    `)

    Expect(validationErrorMessages(result)).toContain(ActionsValidator.messages.dynamicActionArguments)
  })

  Test('rejects action parameters that shadow visible state declarations', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        state Count = 0
        action Add Count is number {
          set Count += Count
        }
        render Text "hi"
      }
    `)

    Expect(validationErrorMessages(result)).toContain(AliasesValidator.messages.duplicateName('Count'))
  })

  Test('reports action arity for do invocations through action aliases', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        state Count = 0
        action AddStep Step is number {
          set Count += Step
        }
        alias CallAdd = AddStep
        action Missing {
          do CallAdd
        }
        render Text "hi"
      }
    `)

    Expect(validationErrorMessages(result)).toContain(ActionsValidator.messages.missingArgument('AddStep', 'Step'))
  })

  Test('reports alias diagnostics when cyclic action aliases are invoked', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      alias First = Second
      alias Second = First
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        action Run {
          do First
        }
        render Text "hi"
      }
    `)

    Expect(validationErrorMessages(result)).toContain(
      AliasesValidator.messages.aliasUsedBeforeDeclaration('First', 'Second'),
    )
  })

  Test('reports invalid set value and compound set state types', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        state Count = 0
        state Name = "Ro"
        action BadSet {
          set Count = "many"
        }
        action BadCompound {
          set Name += "!"
        }
        render Text "hi"
      }
    `)

    Expect(validationErrorMessages(result)).toContain(
      StateValidator.messages.setTypeMismatch('Count', 'number', 'text'),
    )
    Expect(validationErrorMessages(result)).toContain(
      StateValidator.messages.compoundStateType('Name', '+=', 'stateful text'),
    )
  })

  Test('rejects action-valued state and set targets used before declaration', async () => {
    const actionState = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        state Click = action { }
        render Text "hi"
      }
    `)
    const lateSetTarget = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        action AddOne {
          set Count += 1
        }
        state Count = 0
        render Text "hi"
      }
    `)

    Expect(validationErrorMessages(actionState)).toContain(StateValidator.messages.stateActionType('Click'))
    Expect(validationErrorMessages(lateSetTarget)).toContain(StateValidator.messages.usedBeforeDeclaration('Count'))
  })

  Test('rejects action-valued state', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        state Click = action { }
        render Text "hi"
      }
    `)

    Expect(validationErrorMessages(result)).toContain(StateValidator.messages.stateActionType('Click'))
  })

  Test('reports recursive state references without recursing forever', async () => {
    const selfReference = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        state Count = Count
        render Text "hi"
      }
    `)
    const mutualReference = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        state A = B
        state B = A
        render Text "hi"
      }
    `)

    Expect(validationErrorMessages(selfReference)).toContain(StateValidator.messages.usedBeforeDeclaration('Count'))
    Expect(validationErrorMessages(mutualReference)).toContain(StateValidator.messages.usedBeforeDeclaration('B'))
  })

  Test('rejects local state initializer references to later local values', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        state Count = LaterCount
        alias LaterCount = 1
        render Text "hi"
      }
    `)

    Expect(validationErrorMessages(result)).toContain(StateValidator.messages.usedBeforeDeclaration('LaterCount'))
  })

  Test('rejects bare child invocations directly in view bodies', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView {
        Text "Hello"
      }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(result)).toContain(ViewsValidator.messages.viewBody)
  })

  Test('rejects duplicate view parameters', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view Text }
      view Text Value is text, Value is number { }
    `)

    Expect(validationErrorMessages(result)).toContain(ViewsValidator.messages.duplicateParameter('Value'))
    Expect(validationErrorMessages(result)).not.toContain(AliasesValidator.messages.duplicateName('Value'))
  })

  Test('rejects generated view prop names as parameter names', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view ChildrenView }
      view ChildrenView children is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view KeyView key is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view RefView ref is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view TaoPropView __tao is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(result)).toContain(ViewsValidator.messages.reservedParameter('children'))
    Expect(validationErrorMessages(result)).toContain(ViewsValidator.messages.reservedParameter('key'))
    Expect(validationErrorMessages(result)).toContain(ViewsValidator.messages.reservedParameter('ref'))
    Expect(validationErrorMessages(result)).toContain(ViewsValidator.messages.reservedParameter('__tao'))
  })

  Test('requires exactly one render statement in view bodies', async () => {
    const missing = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView {
        alias Greeting = "Hello"
      }
    `)
    const extra = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView {
        render Text "Hello"
        render Text "Again"
      }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(missing)).toContain(ViewsValidator.messages.renderCount('MainView'))
    Expect(validationErrorMessages(extra)).toContain(ViewsValidator.messages.renderCount('MainView'))
  })

  Test('requires render to be the last view body statement', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView {
        render Text "Hello"
        alias Greeting = "Again"
      }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(result)).toContain(ViewsValidator.messages.renderLast)
  })

  Test('allows render inject as the only view body statement', async () => {
    await testValidateCode(`
      app MyApp { view Native }
      view Native {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)
  })

  Test('rejects render inject mixed with view body statements', async () => {
    const withRender = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView {
        render inject ${tsFence}
          return null
        ${fence}
        render MainView
      }
    `)
    const withAlias = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView {
        alias Greeting = "Hello"
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(withRender)).toContain(ViewsValidator.messages.renderInjectPlacement)
    Expect(validationErrorMessages(withAlias)).toContain(ViewsValidator.messages.renderInjectPlacement)
  })

  Test('rejects render inject inside render child blocks', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView {
        render Container {
          render inject ${tsFence}
            return null
          ${fence}
        }
      }
      view Container { }
    `)

    Expect(validationErrorMessages(result)).toContain(ViewsValidator.messages.renderInjectPlacement)
  })

  Test('validates aliases and parameter references as render arguments', async () => {
    await testValidateCode(`
      app MyApp { view MainView }
      alias Greeting = "Hello"
      layout Stack {
        render inject ${tsFence}
          return <>{_ViewProps.children}</>
        ${fence}
      }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view ParameterEcho Label is text {
        render Text Label
      }
      view MainView {
        alias Local = "Local"
        render Stack {
          Text Greeting
          ParameterEcho Local
        }
      }
    `)
  })

  Test('allows block-local aliases inside render child blocks', async () => {
    await testValidateCode(`
      app MyApp { view MainView }
      layout Stack {
        render inject ${tsFence}
          return <>{_ViewProps.children}</>
        ${fence}
      }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        alias Local = "Outer"
        render Stack {
          alias Local = "First"
          Text Local
          Stack {
            alias Local = "Nested"
            Text Local
          }
        }
      }
    `)
  })

  Test('requires render block aliases before child view invocations', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Stack {
        render inject ${tsFence}
          return <>{_ViewProps.children}</>
        ${fence}
      }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Stack {
          Text "First"
          alias Later = "Second"
          Text Later
        }
      }
    `)

    Expect(validationErrorMessages(result)).toContain(ViewsValidator.messages.renderBlockAliasPlacement)
  })

  Test('allows the same alias name in separate render child blocks', async () => {
    await testValidateCode(`
      app MyApp { view MainView }
      layout Stack {
        render inject ${tsFence}
          return <>{_ViewProps.children}</>
        ${fence}
      }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Stack {
          Stack {
            alias Local = "First"
            Text Local
          }
          Stack {
            alias Local = "Second"
            Text Local
          }
        }
      }
    `)
  })

  Test('rejects duplicate aliases in the same render child block', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Stack {
        render inject ${tsFence}
          return <>{_ViewProps.children}</>
        ${fence}
      }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Stack {
          alias Local = "First"
          alias Local = "Second"
          Text Local
        }
      }
    `)

    Expect(validationErrorMessages(result)).toContain(AliasesValidator.messages.duplicateName('Local'))
  })

  Test('rejects duplicate aliases in nested child invocation blocks', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Stack {
        render inject ${tsFence}
          return <>{_ViewProps.children}</>
        ${fence}
      }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Stack {
          Stack {
            alias Local = "First"
            alias Local = "Second"
            Text Local
          }
        }
      }
    `)

    Expect(validationErrorMessages(result)).toContain(AliasesValidator.messages.duplicateName('Local'))
  })

  Test('rejects nested child invocation aliases that shadow visible declarations', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Stack {
        render inject ${tsFence}
          return <>{_ViewProps.children}</>
        ${fence}
      }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Stack {
          Stack {
            alias Text = "shadow"
          }
        }
      }
    `)

    Expect(validationErrorMessages(result)).toContain(AliasesValidator.messages.duplicateName('Text'))
  })

  Test('accepts supported layout clauses on render sites', async () => {
    await testValidateCode(`
      app MyApp { view MainView }
      use Col, Row from @tao/ui
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Col [fill, content top stretch, gap 12, pad 16, margin horizontal 4, width fill] {
          Text "Label" [width fill, height fill]
        }
      }
    `)
  })

  Test('accepts aligned layout terms without static parent direction analysis', async () => {
    await testValidateCode(`
      app MyApp { view MainView }
      use Col, Row, Text from @tao/ui
      view MainView {
        render Col {
          Row {
            Text "Top" [aligned top]
            Text "Bottom" [aligned bottom]
          }
          Col {
            Text "Left" [aligned left]
            Text "Right" [aligned right]
          }
        }
      }
    `)
  })

  Test('accepts content clauses on custom layouts with known root layout direction', async () => {
    await testValidateCode(`
      app MyApp { view MainView }
      use Col, Text from @tao/ui
      layout Screen {
        render Col {
          Text "Screen"
        }
      }
      view MainView {
        render Screen [content center, gap 8]
      }
    `)
  })

  Test(
    'accepts content clauses on ordinary views because runtime resolves the eventual primitive direction',
    async () => {
      await testValidateCode(`
      app MyApp { view MainView }
      use Col, Text from @tao/ui
      view Card {
        render Col {
          Text "Wrapped"
        }
      }
      view MainView {
        render Card [content center]
      }
    `)
    },
  )

  Test('accepts content clauses on imported stdlib layouts by declaration identity', async () => {
    await testValidateCode(`
      app MyApp { view MainView }
      use Row, Text from @tao/ui
      view MainView {
        render Row [content left center] {
          Text "Label"
        }
      }
    `)
  })

  Test('does not require stdlib identity to accept content clauses', async () => {
    await testValidateCode(`
      app MyApp { view MainView }
      view Row {
        render inject \`\`\`ts
          return null
        \`\`\`
      }
      view MainView {
        render Row [content left center]
      }
    `)
  })

  Test('rejects malformed and unknown layout entries', async () => {
    const malformedGap = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Col {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Col [gap fill]
      }
    `)
    const unknownHead = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Col {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Col [unknown 1]
      }
    `)
    const unknownContentTerm = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Col {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Col [content diagonal]
      }
    `)
    const emptyContent = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      use Row from @tao/ui
      view MainView {
        render Row [content]
      }
    `)
    const longContent = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      use Row from @tao/ui
      view MainView {
        render Row [content left center right]
      }
    `)
    const malformedPad = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Col {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Col [pad horizontal]
      }
    `)
    const malformedMargin = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Col {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Col [margin vertical]
      }
    `)
    const alignedStretch = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Col {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Col [aligned stretch]
      }
    `)
    const widthShrink = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Col {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Col [width shrink]
      }
    `)
    const removedExpand = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Col {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Col [expand]
      }
    `)
    const removedStretch = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Col {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Col [stretch]
      }
    `)
    const zeroGap = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Col {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Col [gap 0]
      }
    `)
    const zeroPad = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Col {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Col [pad 0]
      }
    `)
    const zeroMargin = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Col {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Col [margin left 0]
      }
    `)
    const zeroWidth = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Col {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Col [width 0]
      }
    `)
    const zeroHeight = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Col {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Col [height 0]
      }
    `)

    Expect(validationErrorMessages(malformedGap)).toContain(layoutValidationMessages.malformedEntry('gap fill'))
    Expect(validationErrorMessages(unknownHead)).toContain(layoutValidationMessages.unsupportedEntry('unknown 1'))
    Expect(validationErrorMessages(unknownContentTerm)).toContain(
      layoutValidationMessages.unsupportedTerm('content diagonal', 'diagonal'),
    )
    Expect(validationErrorMessages(emptyContent)).toContain(layoutValidationMessages.malformedEntry('content'))
    Expect(validationErrorMessages(longContent)).toContain(
      layoutValidationMessages.malformedEntry('content left center right'),
    )
    Expect(validationErrorMessages(malformedPad)).toContain(layoutValidationMessages.malformedEntry('pad horizontal'))
    Expect(validationErrorMessages(malformedMargin)).toContain(
      layoutValidationMessages.malformedEntry('margin vertical'),
    )
    Expect(validationErrorMessages(alignedStretch)).toContain(
      layoutValidationMessages.unsupportedTerm('aligned stretch', 'stretch'),
    )
    Expect(validationErrorMessages(widthShrink)).toContain(
      layoutValidationMessages.unsupportedTerm('width shrink', 'shrink'),
    )
    Expect(validationErrorMessages(removedExpand)).toContain(layoutValidationMessages.unsupportedEntry('expand'))
    Expect(validationErrorMessages(removedStretch)).toContain(layoutValidationMessages.unsupportedEntry('stretch'))
    Expect(validationErrorMessages(zeroGap)).toContain(layoutValidationMessages.positiveNumber('gap 0'))
    Expect(validationErrorMessages(zeroPad)).toContain(layoutValidationMessages.positiveNumber('pad 0'))
    Expect(validationErrorMessages(zeroMargin)).toContain(layoutValidationMessages.positiveNumber('margin left 0'))
    Expect(validationErrorMessages(zeroWidth)).toContain(layoutValidationMessages.positiveNumber('width 0'))
    Expect(validationErrorMessages(zeroHeight)).toContain(layoutValidationMessages.positiveNumber('height 0'))
  })

  Test('rejects duplicate and conflicting layout entries', async () => {
    const duplicateGap = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Col {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Col [gap 8, gap 12]
      }
    `)
    const compressRigid = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Col {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Col [compress, rigid]
      }
    `)
    const fillAlignment = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Col {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Col [fill, centered]
      }
    `)
    const padSide = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Col {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Col [pad horizontal 8 left 4]
      }
    `)
    const marginSide = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Col {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Col [margin vertical 8 top 4]
      }
    `)
    const contentHorizontalAxis = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      use Row from @tao/ui
      view MainView {
        render Row [content left right]
      }
    `)
    const contentCrossAxis = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      use Row from @tao/ui
      view MainView {
        render Row [content baseline stretch]
      }
    `)
    const contentCenter = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      use Row from @tao/ui
      view MainView {
        render Row [content center center]
      }
    `)
    const duplicateWidth = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Col {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Col [width 100, width 200]
      }
    `)

    Expect(validationErrorMessages(duplicateGap)).toContain(layoutValidationMessages.duplicateEntry('gap'))
    Expect(validationErrorMessages(compressRigid)).toContain(
      layoutValidationMessages.conflictingEntries('compress', 'rigid'),
    )
    Expect(validationErrorMessages(fillAlignment)).toContain(
      layoutValidationMessages.conflictingEntries('fill', 'centered'),
    )
    Expect(validationErrorMessages(padSide)).toContain(layoutValidationMessages.duplicateEntry('pad left'))
    Expect(validationErrorMessages(marginSide)).toContain(layoutValidationMessages.duplicateEntry('margin top'))
    Expect(validationErrorMessages(contentHorizontalAxis)).toContain(
      layoutValidationMessages.conflictingEntries('content left', 'content right'),
    )
    Expect(validationErrorMessages(contentCrossAxis)).toContain(
      layoutValidationMessages.conflictingEntries('content baseline', 'content stretch'),
    )
    Expect(validationErrorMessages(contentCenter)).toContain(layoutValidationMessages.duplicateEntry('content center'))
    Expect(validationErrorMessages(duplicateWidth)).toContain(layoutValidationMessages.duplicateEntry('width'))
  })

  Test('rejects layout clauses on render inject', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView {
        render inject ${tsFence}
          return null
        ${fence} [gap 8]
      }
    `)

    Expect(validationErrorMessages(result)).toContain(layoutValidationMessages.injectLayout)
  })

  Test('rejects alias references to later values', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      alias Greeting = Later
      alias Later = "Hello"
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Text Greeting
      }
    `)

    Expect(validationErrorMessages(result)).toContain(
      AliasesValidator.messages.aliasUsedBeforeDeclaration('Greeting', 'Later'),
    )
  })

  Test('rejects local alias references to later values', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView Label is text {
        alias Greeting = Later
        alias Later = Label
      }
    `)

    Expect(validationErrorMessages(result)).toContain(
      AliasesValidator.messages.aliasUsedBeforeDeclaration('Greeting', 'Later'),
    )
  })

  Test('rejects local render arguments that reference later aliases', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Stack {
        render inject ${tsFence}
          return <>{_ViewProps.children}</>
        ${fence}
      }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Stack {
          Text Local
          alias Local = "Hello"
        }
      }
    `)

    Expect(validationErrorMessages(result)).toContain(AliasesValidator.messages.usedBeforeDeclaration('Local'))
  })

  Test('rejects recursive alias member access without recursing forever', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      alias A = A.X
      view MainView { }
    `)

    Expect(validationErrorMessages(result)).toContain(AliasesValidator.messages.aliasUsedBeforeDeclaration('A', 'A'))
  })

  Test('rejects member access on action declarations', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      action Save { }
      view MainView {
        render Text Save.Label
      }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(result)).toContain(typeValidationMessages.memberNotItem('Label'))
  })

  Test('rejects duplicate file-level aliases', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      alias Greeting = "Hello"
      alias Greeting = "Again"
      view MainView { }
    `)
    const diagnostic = result.diagnostics.find(diagnostic =>
      diagnostic.message === AliasesValidator.messages.duplicateName('Greeting')
    )

    Expect(validationErrorMessages(result)).toContain(AliasesValidator.messages.duplicateName('Greeting'))
    Expect(diagnostic?.nodeType).toBe(AST.AliasDeclaration.$type)
    Expect(diagnostic?.range).toBeDefined()
  })

  Test('rejects duplicate file-level declaration names', async () => {
    const aliasBeforeView = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      alias Text = "Hello"
      view MainView { }
      view Text Value is text { }
    `)
    const aliasAfterApp = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      alias MyApp = "Hello"
      view MainView { }
    `)
    const viewAfterApp = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MyApp { }
      view MainView { }
    `)

    Expect(validationErrorMessages(aliasBeforeView)).toContain(AliasesValidator.messages.duplicateName('Text'))
    Expect(validationErrorMessages(aliasAfterApp)).toContain(AliasesValidator.messages.duplicateName('MyApp'))
    Expect(validationErrorMessages(viewAfterApp)).toContain(AliasesValidator.messages.duplicateName('MyApp'))
  })

  Test('keeps type and value names in separate namespaces', async () => {
    await testValidateCode(`
      app MyApp { view MainView }
      type Name is text
      alias Name = Name "Ro"
      view MainView {
        render Text Name
      }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    const duplicateTypes = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      type Name is text
      type Name is number
      view MainView { }
    `)

    Expect(validationErrorMessages(duplicateTypes)).toContain(aliasValidationMessages.duplicateName('Name'))
  })

  Test('rejects local aliases that shadow view declarations', async () => {
    const aliasShadow = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView {
        alias Text = "Hello"
        render Text Text
      }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)
    const parameterShadow = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView Text is text {
        render Text Text
      }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(aliasShadow)).toContain(AliasesValidator.messages.duplicateName('Text'))
    Expect(validationErrorMessages(parameterShadow)).toContain(AliasesValidator.messages.duplicateName('Text'))
  })

  Test('allows local aliases that shadow file-level aliases', async () => {
    await testValidateCode(`
      app MyApp { view MainView }
      alias Greeting = "Outer"
      layout Stack {
        render inject ${tsFence}
          return <>{_ViewProps.children}</>
        ${fence}
      }
      view MainView {
        alias OuterGreeting = Greeting
        render Stack {
          alias Greeting = "Inner"
          Text Greeting
          Text OuterGreeting
        }
      }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)
  })

  Test('rejects local aliases that shadow visible values', async () => {
    const parameterShadow = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView Label is text {
        alias Label = "shadow"
      }
    `)

    Expect(validationErrorMessages(parameterShadow)).toContain(AliasesValidator.messages.duplicateName('Label'))
  })

  Test('rejects alias self references as undeclared-before references', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      alias First = First
      view MainView { }
    `)

    Expect(validationErrorMessages(result)).toContain(
      AliasesValidator.messages.aliasUsedBeforeDeclaration('First', 'First'),
    )
  })

  Test('rejects mutually recursive aliases through declaration order', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      alias First = Second
      alias Second = First
      view MainView { }
    `)

    Expect(validationErrorMessages(result)).toContain(
      AliasesValidator.messages.aliasUsedBeforeDeclaration('First', 'Second'),
    )
  })

  Test('returns alias declaration-order diagnostics when invalid aliases are used as render arguments', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      alias First = Second
      alias Second = First
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Text First
      }
    `)

    Expect(validationErrorMessages(result)).toContain(
      AliasesValidator.messages.aliasUsedBeforeDeclaration('First', 'Second'),
    )
  })

  Test('rejects render invocation arity errors', async () => {
    const missing = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView {
        render Tile "Open"
      }
      view Tile Title is text, Count is number {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)
    const extra = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView {
        render Text "Open", 1
      }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(missing)).toContain(InvocationsValidator.messages.missingArgument('Tile', 'Count'))
    Expect(
      missing.diagnostics.find(diagnostic =>
        diagnostic.message === InvocationsValidator.messages.missingArgument('Tile', 'Count')
      )?.nodeType,
    ).toBe(AST.RenderStatement.$type)
    Expect(validationErrorMessages(extra)).toContain(invocationValidationMessages.unmatchedArgument('Text'))
  })

  Test('rejects child view invocation arity and type errors', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      layout Stack {
        render inject ${tsFence}
          return <>{_ViewProps.children}</>
        ${fence}
      }
      view MainView {
        render Stack {
          Tile 42
        }
      }
      view Tile Title is text, Count is number {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(result)).toContain(invocationValidationMessages.missingArgument('Tile', 'Title'))
  })

  Test('rejects text and number argument mismatches by type', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView {
        render Tile "not a count"
      }
      view Tile Count is number {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(result)).toContain(invocationValidationMessages.unmatchedArgument('Tile'))
    Expect(validationErrorMessages(result)).toContain(invocationValidationMessages.missingArgument('Tile', 'Count'))
  })

  Test('validates custom type declarations, constructors, casts, member access, and type-based binding', async () => {
    await testValidateCode(`
      app MyApp { view MainView }
      type Name is text
      type Age is number
      type Tags is list
      type Job is {
        Title is text
        Level is number
      }
      type Person is {
        Name
        Age
        Tags
        Job
      }
      type InlineJob is {
        Role is text
        Rank is number
      }
      type CurrentJob is InlineJob
      alias DisplayName = Name "Ada"
      alias DemoPerson = Person {
        Tags ["types"]
        Job { Level 2 Title "Compiler engineer" }
        Age 40
        DisplayName
      }
      alias DemoCurrentJob = CurrentJob { Role "Architect" Rank 3 }
      layout Stack {
        render inject ${tsFence}
          return <>{_ViewProps.children}</>
        ${fence}
      }
      view MainView {
        render Stack {
          Profile DemoPerson
          Summary Count: 2, "People"
        }
      }
      type Count is number
      view Profile Person {
        render Stack {
          TextValue Person.Name
          TextValue Person.Job.Title
        }
      }
      view Summary Label is text, Count {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view TextValue Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)
  })

  Test('rejects duplicate provided exact types before nominal lineage fallback', async () => {
    const duplicateArguments = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      type Base is text
      type Name is Base
      view MainView {
        render Pair Name: "Ada", Name: "Grace"
      }
      view Pair Base, Name {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)
    const duplicateProperties = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      type Base is text
      type Name is Base
      type Pair is {
        Base
        Name
      }
      alias BadPair = Pair { Name "Ada" Name "Grace" }
      view MainView { }
    `)
    const duplicateLineageArguments = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      type Base is text
      type Middle is Base
      type Leaf is Middle
      view MainView {
        render Pair Leaf: "Ada", Leaf: "Grace"
      }
      view Pair Base, Middle {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)
    const duplicateLineageProperties = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      type Base is text
      type Middle is Base
      type Leaf is Middle
      type Pair is {
        Base
        Middle
      }
      alias BadPair = Pair { Leaf "Ada" Leaf "Grace" }
      view MainView { }
    `)

    Expect(validationErrorMessages(duplicateArguments)).toContain(
      invocationValidationMessages.duplicateArgumentType('Pair'),
    )
    Expect(validationErrorMessages(duplicateArguments)).toContain(
      invocationValidationMessages.missingArgument('Pair', 'Base'),
    )
    Expect(validationErrorMessages(duplicateProperties)).toContain(typeValidationMessages.duplicateProvidedPropertyType)
    Expect(validationErrorMessages(duplicateProperties)).toContain(typeValidationMessages.missingProperty('Base'))
    Expect(validationErrorMessages(duplicateLineageArguments)).toContain(
      invocationValidationMessages.duplicateArgumentType('Pair'),
    )
    Expect(validationErrorMessages(duplicateLineageArguments)).toContain(
      invocationValidationMessages.missingArgument('Pair', 'Base'),
    )
    Expect(validationErrorMessages(duplicateLineageArguments)).toContain(
      invocationValidationMessages.missingArgument('Pair', 'Middle'),
    )
    Expect(
      validationErrorMessages(duplicateLineageArguments).some(message =>
        message.includes('matches multiple parameters by type')
      ),
    ).toBe(false)
    Expect(validationErrorMessages(duplicateLineageProperties)).toContain(
      typeValidationMessages.duplicateProvidedPropertyType,
    )
    Expect(validationErrorMessages(duplicateLineageProperties)).toContain(
      typeValidationMessages.missingProperty('Base'),
    )
    Expect(validationErrorMessages(duplicateLineageProperties)).toContain(
      typeValidationMessages.missingProperty('Middle'),
    )
    Expect(
      validationErrorMessages(duplicateLineageProperties).some(message =>
        message.includes('matches multiple fields by type')
      ),
    ).toBe(false)
  })

  Test('binds same-root nominal siblings while rejecting duplicate root literals', async () => {
    await testValidateCode(`
      app MyApp { view MainView }
      type Name is text
      type Title is text
      view MainView {
        render Pair Name: "Ada", Title: "Engineer"
      }
      view Pair Name, Title {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    const duplicateRootArguments = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      type Name is text
      type Title is text
      view MainView {
        render Pair "Ada", "Engineer"
      }
      view Pair Name, Title {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(duplicateRootArguments)).toContain(
      invocationValidationMessages.duplicateArgumentType('Pair'),
    )
    Expect(validationErrorMessages(duplicateRootArguments)).toContain(
      invocationValidationMessages.missingArgument('Pair', 'Name'),
    )
    Expect(validationErrorMessages(duplicateRootArguments)).toContain(
      invocationValidationMessages.missingArgument('Pair', 'Title'),
    )
  })

  Test('rejects ambiguous expected binding types', async () => {
    const ambiguousScopedParameters = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView {
        render Pair "Ada"
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
        render Pair Leaf: "Ada"
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
      alias BadPerson = Person { Name "Ada" }
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
      alias BadPerson = Person { Leaf "Ada" }
      view MainView { }
    `)
    const ambiguousParameter = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      type Base is text
      type Name is Base
      type Title is Base
      view MainView {
        render Pair Name: "Ada", Title: "Grace"
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
      alias BadPair = Pair { Name "Ada" Title "Grace" }
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
      alias BadAge = Age "Ada"
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
      alias BadPerson = Person { Name "Ada" }
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
      alias BadPerson = Person { Name "Ada" Age 40 "extra" }
      view MainView { }
    `)
    const badMember = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      type Name is text
      alias DisplayName = Name "Ada"
      view MainView {
        render Text DisplayName.First
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
      alias DemoPerson = Person { Name "Ada" }
      view MainView {
        render Text DemoPerson.Missing
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
      alias BadBag = Bag { "extra" }
      view MainView {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)
    const unresolvedCast = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      alias Bad = Missing "Ada"
      view MainView {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)
    const unresolvedConstructor = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      alias Bad = Missing "Ada"
      view MainView {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)
    const unresolvedMember = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView {
        render Text Missing.First
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
        render Text Missing
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
      alias BadPerson = Person { Missing }
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
      alias Bad = Person.Missing "Ada"
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
      alias OuterName = Name "Outer"
      alias FamilyName = LastName "Lovelace"
      alias Ada = FullNamePerson {
        Name "Ada"
        FamilyName
      }
      view MainView {
        render Stack {
          Text OuterName
          Text Ada.Name
          Text Ada.LastName
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
      alias OuterAge = Age 42
      view MainView {
        render Card Details: { OuterAge }
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
      alias Bad = A "value"
      view MainView { }
    `)
    const qualifiedResult = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      type A is B.C
      type B is {
        C is A
      }
      alias Bad = A "value"
      view MainView { }
    `)
    const shorthandResult = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      type Person is {
        Friend
      }
      type Friend is Person
      alias Bad = Person { Friend { Friend { } } }
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
      alias Bad = Person "hello"
      view MainView { }
    `)

    Expect(validationErrorMessages(result)).toContain(typeValidationMessages.constructorShape('Person', 'item'))
  })

  Test('reports type diagnostics alongside structural invocation errors', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView {
        render Tile 42, "extra"
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
        render Text Secret
      }
    `)

    Expect(validationErrorMessages(result).length).toBeGreaterThan(0)
    Expect(Diagnostics.hasSource(result.diagnostics, 'validator')).toBe(true)
  })

  Test('validates relative use imports across sibling files', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { view MainView }
        use Text from ./
        view MainView {
          render Text "Hello"
        }
      `,
        'Views.tao': `
        project view Text Value is text {
          render inject Value ${tsFence}
            return <RN.Text>{Value}</RN.Text>
          ${fence}
        }
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toEqual([])
      },
    )
  })

  Test('keeps type references distinct from same-name views', async () => {
    const result = await testValidateCode(`
      app MyApp { view MainView }
      type Card is text
      alias CardValue = Card "Ada"
      view Card {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Text CardValue
      }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(result)).toEqual([])
  })

  Test('resolves same-name qualified item types when renderables lack that scoped member', async () => {
    const result = await testValidateCode(`
      app MyApp { view MainView }
      type Card is {
        Name is text
      }
      alias CardName = Card.Name "Ada"
      view Card Label is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Text CardName
      }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(result)).toEqual([])
  })

  Test('allows imported types to share names with local values', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { view MainView }
        use Name from ./Types.tao
        alias Name = Name "Ro"
        view MainView {
          render Text Name
        }
        view Text Value is text {
          render inject Value ${tsFence}
            return <RN.Text>{Value}</RN.Text>
          ${fence}
        }
      `,
        'Types.tao': `
        alias Name = "Hidden"
        project type Name is text
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toEqual([])
      },
    )
  })

  Test('keeps invisible same-name imports out of value scopes', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { view MainView }
        use Name from ./Types.tao
        view MainView {
          render Text Name
        }
        view Text Value is text {
          render inject Value ${tsFence}
            return <RN.Text>{Value}</RN.Text>
          ${fence}
        }
      `,
        'Types.tao': `
        alias Name = "Hidden"
        project type Name is text
      `,
      },
      async result => {
        Expect(validationErrorMessages(result).some(message => message.includes('Name'))).toBe(true)
      },
    )
  })

  Test('keeps invisible same-name imports out of type scopes', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { view MainView }
        use Name from ./Types.tao
        alias DisplayName = Name "Ro"
        view MainView {
          render Text DisplayName
        }
        view Text Value is text {
          render inject Value ${tsFence}
            return <RN.Text>{Value}</RN.Text>
          ${fence}
        }
      `,
        'Types.tao': `
        type Name is text
        project alias Name = "Visible"
      `,
      },
      async result => {
        Expect(validationErrorMessages(result).some(message => message.includes('Name'))).toBe(true)
      },
    )
  })

  Test('validates explicit Tao file use imports', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { view MainView }
        use Text from ./Views.tao
        view MainView {
          render Text "Hello"
        }
      `,
        'Views.tao': `
        project view Text Value is text {
          render inject Value ${tsFence}
            return <RN.Text>{Value}</RN.Text>
          ${fence}
        }
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toEqual([])
      },
    )
  })

  Test('validates source strings that import the Tao stdlib', async () => {
    await testValidateCode(`
      use Text from @tao/ui
      app MyApp { view MainView }
      view MainView {
        render Text "Hello"
      }
    `)
  })

  Test('rejects file-private imports from another file in the same directory', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { view MainView }
        use Text from ./
        view MainView {
          render Text "Hello"
        }
      `,
        'Views.tao': `
        view Text Value is text {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toContain(useValidationMessages.notVisible('Text'))
      },
    )
  })

  Test('rejects cross-file imports for declarations that are not visible', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { view MainView }
        use Text from ./views
        view MainView { }
      `,
        'views/Views.tao': `
        view Text Value is text {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toContain(useValidationMessages.notVisible('Text'))
      },
    )
  })

  Test('reports validator errors inside imported Tao files', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { view MainView }
        use Text from ./
        view MainView {
          render Text "Hello"
        }
      `,
        'Views.tao': `
        project view Text Value is text {
          render inject Value, Value ${tsFence}
            return null
          ${fence}
        }
      `,
      },
      async result => {
        const diagnostic = result.diagnostics.find(diagnostic =>
          diagnostic.message === injectionValidationMessages.duplicateArgument('Value')
        )

        Expect(validationErrorMessages(result)).toContain(injectionValidationMessages.duplicateArgument('Value'))
        Expect(diagnostic?.filePath?.endsWith('/Views.tao')).toBe(true)
      },
    )
  })

  Test('reports parser errors inside imported Tao files', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { view MainView }
        use Text from ./
        view MainView {
          render Text "Hello"
        }
      `,
        'Views.tao': 'view Text Value is text {',
      },
      async result => {
        Expect(Diagnostics.hasSource(result.diagnostics, 'parser')).toBe(true)
      },
    )
  })

  Test('keeps parser errors from different imported files distinct', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { view MainView }
        use BrokenOne from ./one
        use BrokenTwo from ./two
        view MainView { }
      `,
        'one/BrokenOne.tao': 'view BrokenOne {',
        'two/BrokenTwo.tao': 'view BrokenTwo {',
      },
      async result => {
        const parserDiagnostics = Diagnostics.errors(result.diagnostics, 'parser')

        Expect(parserDiagnostics).toHaveLength(2)
        Expect(new Set(parserDiagnostics.map(diagnostic => diagnostic.filePath)).size).toBe(2)
      },
    )
  })

  Test('reports unresolved references inside imported Tao files', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { view MainView }
        use Text from ./
        view MainView {
          render Text "Hello"
        }
      `,
        'Views.tao': `
        project view Text Value is text {
          render MissingView
        }
      `,
      },
      async result => {
        Expect(Diagnostics.hasMessageContaining(Diagnostics.errors(result.diagnostics, 'linker'), 'MissingView')).toBe(
          true,
        )
      },
    )
  })

  Test('rejects names imported by more than one use statement', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { view MainView }
        use Text from ./
        use Text from ./
        view MainView {
          render Text "Hello"
        }
      `,
        'Views.tao': `
        project view Text Value is text {
          render inject Value ${tsFence}
            return <RN.Text>{Value}</RN.Text>
          ${fence}
        }
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toContain(useValidationMessages.repeatedImport('Text'))
      },
    )
  })

  Test('rejects imports that collide with declarations in the importing file', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
      app MyApp { view MainView }
      use Text from ./Views.tao
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Text "Hello"
      }
    `,
        'Views.tao': `
      project view Text Value is text {
        render inject Value ${tsFence}
          return <RN.Text>{Value}</RN.Text>
        ${fence}
      }
    `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toContain(useValidationMessages.localDeclarationCollision('Text'))
      },
    )
  })

  Test('rejects app imports', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { view MainView }
        use OtherApp from ./Other.tao
        view MainView {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
        'Other.tao': `
        app OtherApp { view OtherView }
        view OtherView {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toContain(useValidationMessages.appImport('OtherApp'))
      },
    )
  })

  Test('rejects app declarations outside the entry file', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { view MainView }
        use OtherView from ./Other.tao
        view MainView {
          render OtherView
        }
      `,
        'Other.tao': `
        app OtherApp { view OtherView }
        project view OtherView {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toContain(AppValidator.messages.appEntryFile('OtherApp'))
      },
    )
  })

  Test('rejects app declarations inside packages', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { view MainView }
        use MainView from @bar
      `,
        'packages/@bar/Main.tao': `
        app PackageApp { view MainView }
        project view MainView {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toContain(AppValidator.messages.appPackage('PackageApp'))
      },
    )
  })

  Test('rejects imports that match multiple visible declarations in an import target', async () => {
    const sharedTextSource = `
      project view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { view MainView }
        use Text from ./views
        view MainView {
          render Text "Hello"
        }
      `,
        'views/Views.tao': sharedTextSource,
        'views/MoreViews.tao': sharedTextSource,
      },
      async result => {
        Expect(validationErrorMessages(result)).toContain(useValidationMessages.ambiguousImport('Text', './views'))
      },
    )
  })

  Test('allows file-level aliases that reference imported aliases', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { view MainView }
        use Greeting from ./
        alias Local = Greeting
        view Text Value is text {
          render inject Value ${tsFence}
            return <RN.Text>{Value}</RN.Text>
          ${fence}
        }
        view MainView {
          render Text Local
        }
      `,
        'Views.tao': `
        // Padding comments keep this declaration at a larger source offset than the
        // importing file's references, which used to trip the declaration-order check.
        // More padding.
        // More padding.
        project alias Greeting = "Hello"
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toEqual([])
      },
    )
  })

  Test('validates bare use imports across a whole package', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app PackageApp { view MainView }
        use MainView from @foo/forms
      `,
        'features/@foo/Title.tao': `
        package alias PackageTitle = "Package title"
      `,
        'features/@foo/forms/Main.tao': `
        use PackageTitle
        project view MainView {
          render Text PackageTitle
        }
        view Text Value is text {
          render inject Value ${tsFence}
            return null
          ${fence}
        }
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toEqual([])
      },
    )
  })

  Test('resolves package imports through the project package index', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app IndexedPackageApp { view MainView }
        use MainView from @bar/views
      `,
        'deep/packages/@bar/views/Main.tao': `
        project view MainView {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toEqual([])
      },
    )
  })

  Test('resolves package paths through folders instead of file basenames', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app FolderTargetApp { view MainView }
        use Chosen from @foo/Widget
        use FileOnly from @foo/FileOnly
        use ExplicitFile from @foo/ExplicitFile.tao
        view MainView {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
        'features/@foo/Widget.tao': `
        project alias Chosen = "Wrong file target"
      `,
        'features/@foo/Widget/Index.tao': `
        project alias Chosen = "Folder target"
      `,
        'features/@foo/FileOnly.tao': `
        project alias FileOnly = "File target"
      `,
        'features/@foo/ExplicitFile.tao': `
        project alias ExplicitFile = "Explicit file target"
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toContain(useValidationMessages.unresolvedImport('@foo/FileOnly'))
        Expect(validationErrorMessages(result)).toContain(
          useValidationMessages.unresolvedImport('@foo/ExplicitFile.tao'),
        )
      },
    )
  })

  Test('rejects duplicate package names in the package index', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app DuplicatePackageApp { view MainView }
        use MainView from @bar
      `,
        'one/@bar/Main.tao': `
        project view MainView {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
        'two/@bar/Main.tao': `
        project view OtherView {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
      },
      async result => {
        Expect(validationErrorMessages(result).some(message => message.includes("Package '@bar' is ambiguous"))).toBe(
          true,
        )
      },
    )
  })

  Test('rejects relative imports that cross package boundaries', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app BoundaryApp { view MainView }
        use MainView from ./features/@bar
      `,
        'features/@bar/Main.tao': `
        project view MainView {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toContain(useValidationMessages.packageBoundary('./features/@bar'))
      },
    )
  })

  Test('keeps package-visible declarations out of cross-package imports', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app VisibilityApp { view MainView }
        use MainView from @bar
      `,
        'features/@bar/Main.tao': `
        package view MainView {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toContain(useValidationMessages.notVisible('MainView'))
      },
    )
  })

  Test('does not include nested package folders in bare package imports', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app NestedPackageApp { view MainView }
        use MainView from @outer
        use InnerView from @inner
      `,
        'features/@outer/Main.tao': `
        use NestedAlias
        project view MainView {
          render Text NestedAlias
        }
        view Text Value is text {
          render inject Value ${tsFence}
            return null
          ${fence}
        }
      `,
        'features/@outer/@inner/Main.tao': `
        package alias NestedAlias = "Nested"
        project view InnerView {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toContain(
          useValidationMessages.missingImport('NestedAlias', 'current package'),
        )
      },
    )
  })

  Test('does not load nested package files through bare package imports', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app NestedPackageApp { view MainView }
        use MainView from @outer
      `,
        'features/@outer/Main.tao': `
        project view MainView {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
        'features/@outer/@inner/Broken.tao': 'view Broken {',
      },
      async result => {
        Expect(Diagnostics.hasSource(result.diagnostics, 'parser')).toBe(false)
        Expect(validationErrorMessages(result)).toEqual([])
      },
    )
  })

  Test('rejects duplicate visible declarations in sibling package files', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app DuplicateVisibleApp { view MainView }
        use MainView from @foo
      `,
        'features/@foo/Main.tao': `
        project view MainView {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
        'features/@foo/First.tao': `
        package alias Shared = "First"
      `,
        'features/@foo/Second.tao': `
        publish alias Shared = "Second"
      `,
      },
      async result => {
        const duplicateMessages = validationErrorMessages(result).filter(message =>
          message.startsWith("Visible declaration 'Shared' is declared more than once in folder ")
        )

        Expect(duplicateMessages).toHaveLength(2)
      },
    )
  })

  Test('validates local project metadata blocks', async () => {
    const result = await testValidateCodeWithErrors(`
      project {
        name "One"
        name "Two"
        remote none
        remote none
        license MIT
        license Apache
        requires foo
      }
      project {
        name "Duplicate"
      }
      app MetadataApp { view MainView }
      view MainView {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(result)).toContain(projectValidationMessages.duplicateProject())
    Expect(validationErrorMessages(result)).toContain(projectValidationMessages.duplicateName())
    Expect(validationErrorMessages(result)).toContain(projectValidationMessages.duplicateRemote())
    Expect(validationErrorMessages(result)).toContain(projectValidationMessages.duplicateLicense())
    Expect(validationErrorMessages(result)).toContain(projectValidationMessages.unsupportedRequires())
  })
})

Describe('Tao validator use organization diagnostics', () => {
  Test('warns about unused imports with a quick-fix code', async () => {
    const result = await Validator.validateCode(`
      use Text, Stack from @tao/ui
      app MyApp { view MainView }
      view MainView {
        render Text "hi"
      }
    `)
    const warning = result.diagnostics.find(diagnostic =>
      diagnostic.message === useValidationMessages.unusedImport('Stack')
    )

    Expect(validationErrorMessages(result)).toEqual([])
    Expect(warning?.severity).toBe('warning')
    Expect(warning?.code).toBe(useValidationCodes.unusedImport)
  })

  Test('treats imported shorthand item field types as used', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        use Name from ./Types.tao
        app MyApp { view MainView }
        type Person is {
          Name
        }
        view MainView {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
        'Types.tao': `
        project type Name is text
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toEqual([])
        Expect(
          result.diagnostics.some(diagnostic => diagnostic.message === useValidationMessages.unusedImport('Name')),
        ).toBe(false)
      },
    )
  })

  Test('warns about use statements after other top-level statements', async () => {
    const result = await Validator.validateCode(`
      app MyApp { view MainView }
      use Text from @tao/ui
      view MainView {
        render Text "hi"
      }
    `)
    const warning = result.diagnostics.find(diagnostic => diagnostic.message === useValidationMessages.useOutOfSection)

    Expect(validationErrorMessages(result)).toEqual([])
    Expect(warning?.severity).toBe('warning')
    Expect(warning?.code).toBe(useValidationCodes.useOutOfSection)
  })

  Test('reports no organization warnings for a canonical import section', async () => {
    const result = await Validator.validateCode(`
      use Text from @tao/ui
      app MyApp { view MainView }
      view MainView {
        render Text "hi"
      }
    `)

    Expect(result.diagnostics.filter(diagnostic => diagnostic.severity === 'warning')).toEqual([])
  })
})
