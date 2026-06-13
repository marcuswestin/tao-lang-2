import { AST } from '@parser'
import { Diagnostics, FS, Text } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { ValidationResult } from '@validator'
import { Workspace } from '@workspace'
import { aliasValidationMessages } from '../validator-src/aliases-validator'
import { appValidationMessages } from '../validator-src/app-validator'
import { inferExpressionType } from '../validator-src/expressions-validator'
import { injectionValidationMessages } from '../validator-src/injections-validator'
import { invocationValidationMessages } from '../validator-src/invocations-validator'
import { projectValidationMessages } from '../validator-src/project-validator'
import { useValidationMessages } from '../validator-src/use-validator'
import { viewValidationMessages } from '../validator-src/views-validator'
import { testValidateCode, testValidateCodeWithErrors, validationErrorMessages } from './test-validate'

const kitchenSinkPath = FS.repoPath('Apps/Kitchen Sink/Kitchen Sink.tao')
const targetKitchenSinkPath = FS.repoPath('Apps/Kitchen Sink - Target/Kitchen Sink - Target.tao')
const typeSystemTestsPath = FS.repoPath('Apps/Test Apps/Type System Tests/Type System Tests.tao')
const runtimeStdlibTestsPath = FS.repoPath('Apps/Test Apps/Runtime Stdlib Tests/Runtime Stdlib Tests.tao')
const tsFence = '```ts'
const fence = '```'

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

  Test('validates the target Kitchen Sink app', async () => {
    const result = await Workspace.validate(targetKitchenSinkPath)

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

  Test('validates an existing parser result', async () => {
    await withValidationParse(
      `
      app MyApp { ui MainView }
      ui MainView {
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

  Test('returns parser diagnostics without running structural checks on syntax errors', async () => {
    const result = await testValidateCodeWithErrors('ui Broken { render }')

    Expect(Diagnostics.hasSource(result.diagnostics, 'parser')).toBe(true)
    Expect(Diagnostics.hasSource(result.diagnostics, 'validator')).toBe(false)
  })

  Test('exposes Typir services for primitive expression inference', async () => {
    await withValidationParse(
      `
      app MyApp { ui MainView }
      alias Greeting = "Hello"
      alias Count = 3
      ui MainView { }
    `,
      ({ result, workspace }) => {
        const aliases = result.entry.ast.statements.filter(AST.isAliasDeclaration)

        Expect(inferExpressionType(aliases[0]!.value, workspace.typir)).toBe('text')
        Expect(inferExpressionType(aliases[1]!.value, workspace.typir)).toBe('number')
      },
    )
  })

  Test('rejects unsupported top-level statements', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      render MainView
      ui MainView { }
    `)

    Expect(validationErrorMessages(result)).toContain(appValidationMessages.topLevel)
  })

  Test('requires at most one app declaration', async () => {
    await testValidateCode(`
      ui MainView {
        render inject \`\`\`ts
          return null
        \`\`\`
      }
    `)
    const duplicate = await testValidateCodeWithErrors(`
      app First { ui MainView }
      app Second { ui MainView }
      ui MainView { }
    `)

    Expect(validationErrorMessages(duplicate)).toContain(appValidationMessages.appCount(2))
  })

  Test('requires exactly one root ui in app blocks', async () => {
    const missing = await testValidateCodeWithErrors(`
      app MyApp { }
      ui MainView { }
    `)
    const duplicate = await testValidateCodeWithErrors(`
      app MyApp {
        ui MainView
        ui OtherView
      }
      ui MainView { }
      ui OtherView { }
    `)

    Expect(validationErrorMessages(missing)).toContain(appValidationMessages.appRootCount('MyApp', 0))
    Expect(validationErrorMessages(duplicate)).toContain(appValidationMessages.appRootCount('MyApp', 2))
  })

  Test('rejects app root ui declarations with parameters', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      ui MainView Label text {
        render Text Label
      }
      ui Text Value text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(result)).toContain(appValidationMessages.rootUiParameters('MyApp', 'MainView'))
  })

  Test('rejects non-root-ui statements in app blocks', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp {
        alias Greeting = "Hello"
        ui MainView
      }
      ui MainView { }
    `)

    Expect(validationErrorMessages(result)).toContain(appValidationMessages.appBlock('MyApp'))
  })

  Test('rejects unsupported ui body statements', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      ui MainView {
        ui Nested { }
      }
    `)

    Expect(validationErrorMessages(result)).toContain(viewValidationMessages.viewBody)
  })

  Test('rejects bare child invocations directly in view bodies', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      ui MainView {
        Text "Hello"
      }
      ui Text Value text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(result)).toContain(viewValidationMessages.viewBody)
  })

  Test('rejects duplicate ui parameters', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui Text }
      ui Text Value text, Value text { }
    `)

    Expect(validationErrorMessages(result)).toContain(viewValidationMessages.duplicateParameter('Value'))
    Expect(validationErrorMessages(result)).not.toContain(aliasValidationMessages.duplicateName('Value'))
  })

  Test('rejects generated view prop names as parameter names', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui ChildrenView }
      ui ChildrenView children text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      ui KeyView key text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      ui RefView ref text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      ui TaoPropView __tao text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(result)).toContain(viewValidationMessages.reservedParameter('children'))
    Expect(validationErrorMessages(result)).toContain(viewValidationMessages.reservedParameter('key'))
    Expect(validationErrorMessages(result)).toContain(viewValidationMessages.reservedParameter('ref'))
    Expect(validationErrorMessages(result)).toContain(viewValidationMessages.reservedParameter('__tao'))
  })

  Test('requires exactly one render statement in ui bodies', async () => {
    const missing = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      ui MainView {
        alias Greeting = "Hello"
      }
    `)
    const extra = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      ui MainView {
        render Text "Hello"
        render Text "Again"
      }
      ui Text Value text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(missing)).toContain(viewValidationMessages.renderCount('MainView'))
    Expect(validationErrorMessages(extra)).toContain(viewValidationMessages.renderCount('MainView'))
  })

  Test('requires render to be the last ui body statement', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      ui MainView {
        render Text "Hello"
        alias Greeting = "Again"
      }
      ui Text Value text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(result)).toContain(viewValidationMessages.renderLast)
  })

  Test('allows render inject as the only ui body statement', async () => {
    await testValidateCode(`
      app MyApp { ui Native }
      ui Native {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)
  })

  Test('rejects render inject mixed with ui body statements', async () => {
    const withRender = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      ui MainView {
        render inject ${tsFence}
          return null
        ${fence}
        render MainView
      }
    `)
    const withAlias = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      ui MainView {
        alias Greeting = "Hello"
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(withRender)).toContain(viewValidationMessages.renderInjectPlacement)
    Expect(validationErrorMessages(withAlias)).toContain(viewValidationMessages.renderInjectPlacement)
  })

  Test('rejects render inject inside render child blocks', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      ui MainView {
        render Container {
          render inject ${tsFence}
            return null
          ${fence}
        }
      }
      ui Container { }
    `)

    Expect(validationErrorMessages(result)).toContain(viewValidationMessages.renderInjectPlacement)
  })

  Test('validates aliases and parameter references as render arguments', async () => {
    await testValidateCode(`
      app MyApp { ui MainView }
      alias Greeting = "Hello"
      layout Stack {
        render inject ${tsFence}
          return <>{_ViewProps.children}</>
        ${fence}
      }
      ui Text Value text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      ui ParameterEcho Label text {
        render Text Label
      }
      ui MainView {
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
      app MyApp { ui MainView }
      layout Stack {
        render inject ${tsFence}
          return <>{_ViewProps.children}</>
        ${fence}
      }
      ui Text Value text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      ui MainView {
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
      app MyApp { ui MainView }
      layout Stack {
        render inject ${tsFence}
          return <>{_ViewProps.children}</>
        ${fence}
      }
      ui Text Value text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      ui MainView {
        render Stack {
          Text "First"
          alias Later = "Second"
          Text Later
        }
      }
    `)

    Expect(validationErrorMessages(result)).toContain(viewValidationMessages.renderBlockAliasPlacement)
  })

  Test('allows the same alias name in separate render child blocks', async () => {
    await testValidateCode(`
      app MyApp { ui MainView }
      layout Stack {
        render inject ${tsFence}
          return <>{_ViewProps.children}</>
        ${fence}
      }
      ui Text Value text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      ui MainView {
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
      app MyApp { ui MainView }
      layout Stack {
        render inject ${tsFence}
          return <>{_ViewProps.children}</>
        ${fence}
      }
      ui Text Value text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      ui MainView {
        render Stack {
          alias Local = "First"
          alias Local = "Second"
          Text Local
        }
      }
    `)

    Expect(validationErrorMessages(result)).toContain(aliasValidationMessages.duplicateName('Local'))
  })

  Test('rejects duplicate aliases in nested child invocation blocks', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      layout Stack {
        render inject ${tsFence}
          return <>{_ViewProps.children}</>
        ${fence}
      }
      ui Text Value text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      ui MainView {
        render Stack {
          Stack {
            alias Local = "First"
            alias Local = "Second"
            Text Local
          }
        }
      }
    `)

    Expect(validationErrorMessages(result)).toContain(aliasValidationMessages.duplicateName('Local'))
  })

  Test('rejects nested child invocation aliases that shadow visible declarations', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      layout Stack {
        render inject ${tsFence}
          return <>{_ViewProps.children}</>
        ${fence}
      }
      ui Text Value text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      ui MainView {
        render Stack {
          Stack {
            alias Text = "shadow"
          }
        }
      }
    `)

    Expect(validationErrorMessages(result)).toContain(aliasValidationMessages.duplicateName('Text'))
  })

  Test('rejects alias references to later values', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      alias Greeting = Later
      alias Later = "Hello"
      ui Text Value text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      ui MainView {
        render Text Greeting
      }
    `)

    Expect(validationErrorMessages(result)).toContain(
      aliasValidationMessages.aliasUsedBeforeDeclaration('Greeting', 'Later'),
    )
  })

  Test('rejects local alias references to later values', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      ui MainView Label text {
        alias Greeting = Later
        alias Later = Label
      }
    `)

    Expect(validationErrorMessages(result)).toContain(
      aliasValidationMessages.aliasUsedBeforeDeclaration('Greeting', 'Later'),
    )
  })

  Test('rejects local render arguments that reference later aliases', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      layout Stack {
        render inject ${tsFence}
          return <>{_ViewProps.children}</>
        ${fence}
      }
      ui Text Value text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      ui MainView {
        render Stack {
          Text Local
          alias Local = "Hello"
        }
      }
    `)

    Expect(validationErrorMessages(result)).toContain(aliasValidationMessages.usedBeforeDeclaration('Local'))
  })

  Test('rejects duplicate file-level aliases', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      alias Greeting = "Hello"
      alias Greeting = "Again"
      ui MainView { }
    `)
    const diagnostic = result.diagnostics.find(diagnostic =>
      diagnostic.message === aliasValidationMessages.duplicateName('Greeting')
    )

    Expect(validationErrorMessages(result)).toContain(aliasValidationMessages.duplicateName('Greeting'))
    Expect(diagnostic?.nodeType).toBe(AST.AliasDeclaration.$type)
    Expect(diagnostic?.range).toBeDefined()
  })

  Test('rejects duplicate file-level declaration names', async () => {
    const aliasBeforeView = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      alias Text = "Hello"
      ui MainView { }
      ui Text Value text { }
    `)
    const aliasAfterApp = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      alias MyApp = "Hello"
      ui MainView { }
    `)
    const viewAfterApp = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      ui MyApp { }
      ui MainView { }
    `)

    Expect(validationErrorMessages(aliasBeforeView)).toContain(aliasValidationMessages.duplicateName('Text'))
    Expect(validationErrorMessages(aliasAfterApp)).toContain(aliasValidationMessages.duplicateName('MyApp'))
    Expect(validationErrorMessages(viewAfterApp)).toContain(aliasValidationMessages.duplicateName('MyApp'))
  })

  Test('rejects local aliases that shadow view declarations', async () => {
    const aliasShadow = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      ui MainView {
        alias Text = "Hello"
        render Text Text
      }
      ui Text Value text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)
    const parameterShadow = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      ui MainView Text text {
        render Text Text
      }
      ui Text Value text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(aliasShadow)).toContain(aliasValidationMessages.duplicateName('Text'))
    Expect(validationErrorMessages(parameterShadow)).toContain(aliasValidationMessages.duplicateName('Text'))
  })

  Test('allows local aliases that shadow file-level aliases', async () => {
    await testValidateCode(`
      app MyApp { ui MainView }
      alias Greeting = "Outer"
      layout Stack {
        render inject ${tsFence}
          return <>{_ViewProps.children}</>
        ${fence}
      }
      ui MainView {
        alias OuterGreeting = Greeting
        render Stack {
          alias Greeting = "Inner"
          Text Greeting
          Text OuterGreeting
        }
      }
      ui Text Value text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)
  })

  Test('rejects local aliases that shadow visible values', async () => {
    const parameterShadow = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      ui MainView Label text {
        alias Label = "shadow"
      }
    `)

    Expect(validationErrorMessages(parameterShadow)).toContain(aliasValidationMessages.duplicateName('Label'))
  })

  Test('rejects alias self references as undeclared-before references', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      alias First = First
      ui MainView { }
    `)

    Expect(validationErrorMessages(result)).toContain(
      aliasValidationMessages.aliasUsedBeforeDeclaration('First', 'First'),
    )
  })

  Test('rejects mutually recursive aliases through declaration order', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      alias First = Second
      alias Second = First
      ui MainView { }
    `)

    Expect(validationErrorMessages(result)).toContain(
      aliasValidationMessages.aliasUsedBeforeDeclaration('First', 'Second'),
    )
  })

  Test('returns alias declaration-order diagnostics when invalid aliases are used as render arguments', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      alias First = Second
      alias Second = First
      ui Text Value text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      ui MainView {
        render Text First
      }
    `)

    Expect(validationErrorMessages(result)).toContain(
      aliasValidationMessages.aliasUsedBeforeDeclaration('First', 'Second'),
    )
  })

  Test('rejects render invocation arity errors', async () => {
    const missing = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      ui MainView {
        render Tile "Open"
      }
      ui Tile Title text, Count number {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)
    const extra = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      ui MainView {
        render Text "Open", 1
      }
      ui Text Value text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(missing)).toContain(invocationValidationMessages.missingArgument('Tile', 'Count'))
    Expect(
      missing.diagnostics.find(diagnostic =>
        diagnostic.message === invocationValidationMessages.missingArgument('Tile', 'Count')
      )?.nodeType,
    ).toBe(AST.RenderStatement.$type)
    Expect(validationErrorMessages(extra)).toContain(invocationValidationMessages.extraArguments('Text', 1, 2))
  })

  Test('rejects child view invocation arity and type errors', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      layout Stack {
        render inject ${tsFence}
          return <>{_ViewProps.children}</>
        ${fence}
      }
      ui MainView {
        render Stack {
          Tile 42
        }
      }
      ui Tile Title text, Count number {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(result)).toContain(invocationValidationMessages.missingArgument('Tile', 'Count'))
    Expect(validationErrorMessages(result)).toContain("Argument for parameter 'Title' expects text, got number.")
  })

  Test('rejects text and number argument mismatches through Typir', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      ui MainView {
        render Tile "Open", "not a count"
      }
      ui Tile Title text, Count number {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(result)).toContain("Argument for parameter 'Count' expects number, got text.")
  })

  Test('reports type diagnostics alongside structural invocation errors', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      ui MainView {
        render Tile 42, "extra"
      }
      ui Tile Title text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(result)).toContain(invocationValidationMessages.extraArguments('Tile', 1, 2))
    Expect(validationErrorMessages(result)).toContain("Argument for parameter 'Title' expects text, got number.")
  })

  Test('keeps cross-view values out of scope through validator diagnostics', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui Target }
      ui Text Value text { }
      ui Source Secret text { }
      ui Target {
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
        app MyApp { ui MainView }
        use Text from ./
        ui MainView {
          render Text "Hello"
        }
      `,
        'Views.tao': `
        project ui Text Value text {
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

  Test('validates explicit Tao file use imports', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { ui MainView }
        use Text from ./Views.tao
        ui MainView {
          render Text "Hello"
        }
      `,
        'Views.tao': `
        project ui Text Value text {
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
      app MyApp { ui MainView }
      ui MainView {
        render Text "Hello"
      }
    `)
  })

  Test('rejects file-private imports from another file in the same directory', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { ui MainView }
        use Text from ./
        ui MainView {
          render Text "Hello"
        }
      `,
        'Views.tao': `
        ui Text Value text {
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
        app MyApp { ui MainView }
        use Text from ./ui
        ui MainView { }
      `,
        'ui/Views.tao': `
        ui Text Value text {
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
        app MyApp { ui MainView }
        use Text from ./
        ui MainView {
          render Text "Hello"
        }
      `,
        'Views.tao': `
        project ui Text Value text {
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
        app MyApp { ui MainView }
        use Text from ./
        ui MainView {
          render Text "Hello"
        }
      `,
        'Views.tao': 'ui Text Value text {',
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
        app MyApp { ui MainView }
        use BrokenOne from ./one
        use BrokenTwo from ./two
        ui MainView { }
      `,
        'one/BrokenOne.tao': 'ui BrokenOne {',
        'two/BrokenTwo.tao': 'ui BrokenTwo {',
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
        app MyApp { ui MainView }
        use Text from ./
        ui MainView {
          render Text "Hello"
        }
      `,
        'Views.tao': `
        project ui Text Value text {
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
        app MyApp { ui MainView }
        use Text from ./
        use Text from ./
        ui MainView {
          render Text "Hello"
        }
      `,
        'Views.tao': `
        project ui Text Value text {
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
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      use Text from ./
      ui Text Value text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      ui MainView {
        render Text "Hello"
      }
    `)

    Expect(validationErrorMessages(result)).toContain(useValidationMessages.localDeclarationCollision('Text'))
  })

  Test('rejects app imports', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { ui MainView }
        use OtherApp from ./Other.tao
        ui MainView {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
        'Other.tao': `
        app OtherApp { ui OtherView }
        ui OtherView {
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

  Test('rejects imports that match multiple visible declarations in an import target', async () => {
    const sharedTextSource = `
      project ui Text Value text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { ui MainView }
        use Text from ./ui
        ui MainView {
          render Text "Hello"
        }
      `,
        'ui/Views.tao': sharedTextSource,
        'ui/MoreViews.tao': sharedTextSource,
      },
      async result => {
        Expect(validationErrorMessages(result)).toContain(useValidationMessages.ambiguousImport('Text', './ui'))
      },
    )
  })

  Test('allows file-level aliases that reference imported aliases', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { ui MainView }
        use Greeting from ./
        alias Local = Greeting
        ui Text Value text {
          render inject Value ${tsFence}
            return <RN.Text>{Value}</RN.Text>
          ${fence}
        }
        ui MainView {
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
        app PackageApp { ui MainView }
        use MainView from @foo/forms
      `,
        'features/@foo/Title.tao': `
        package alias PackageTitle = "Package title"
      `,
        'features/@foo/forms/Main.tao': `
        use PackageTitle
        project ui MainView {
          render Text PackageTitle
        }
        ui Text Value text {
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
        app IndexedPackageApp { ui MainView }
        use MainView from @bar/views
      `,
        'deep/packages/@bar/views/Main.tao': `
        project ui MainView {
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
        app FolderTargetApp { ui MainView }
        use Chosen from @foo/Widget
        use FileOnly from @foo/FileOnly
        use ExplicitFile from @foo/ExplicitFile.tao
        ui MainView {
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
        app DuplicatePackageApp { ui MainView }
        use MainView from @bar
      `,
        'one/@bar/Main.tao': `
        project ui MainView {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
        'two/@bar/Main.tao': `
        project ui OtherView {
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
        app BoundaryApp { ui MainView }
        use MainView from ./features/@bar
      `,
        'features/@bar/Main.tao': `
        project ui MainView {
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
        app VisibilityApp { ui MainView }
        use MainView from @bar
      `,
        'features/@bar/Main.tao': `
        package ui MainView {
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
        app NestedPackageApp { ui MainView }
        use MainView from @outer
        use InnerView from @inner
      `,
        'features/@outer/Main.tao': `
        use NestedAlias
        project ui MainView {
          render Text NestedAlias
        }
        ui Text Value text {
          render inject Value ${tsFence}
            return null
          ${fence}
        }
      `,
        'features/@outer/@inner/Main.tao': `
        package alias NestedAlias = "Nested"
        project ui InnerView {
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
        app NestedPackageApp { ui MainView }
        use MainView from @outer
      `,
        'features/@outer/Main.tao': `
        project ui MainView {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
        'features/@outer/@inner/Broken.tao': 'ui Broken {',
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
        app DuplicateVisibleApp { ui MainView }
        use MainView from @foo
      `,
        'features/@foo/Main.tao': `
        project ui MainView {
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
      app MetadataApp { ui MainView }
      ui MainView {
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
