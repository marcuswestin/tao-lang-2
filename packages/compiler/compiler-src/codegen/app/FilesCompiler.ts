import { AST } from '@parser'
import { type CodegenOptions, type Compiled, gen } from '../codegen-util'
import { Compile } from '../Compile'
import { isRuntimeConfigurableDeclaration } from './ConfigurationCompiler'
import { activeFixtureStores } from './data-store-context'

type TaoFileCompileOptions = CodegenOptions & {
  bridgeTypes?: string
  configurationTypes?: string
  dataEntities?: readonly AST.EntityDataDeclaration[]
  dataAccess?: readonly AST.AccessDeclaration[]
  emitDataCatalog?: boolean
  importLines?: string[]
  scopeBindings?: string[]
  exportedBindings?: ReadonlyArray<{ exported: string; binding: string }>
  viewRegistrations?: string
}

export const FilesCompiler = {
  /** TaoFile compiles a parsed Tao file into a default React component module. */
  TaoFile(taoFile: AST.TaoFile, opts: TaoFileCompileOptions = {}): Compiled {
    const configurationTypes = opts.configurationTypes ?? ''
    const bridgeTypes = opts.bridgeTypes ?? ''
    const importLines = opts.importLines?.join('\n') ?? ''
    const scopeBindings = opts.scopeBindings?.join('\n') ?? ''
    const viewRegistrations = opts.viewRegistrations ?? ''
    const exportLines = opts.exportedBindings
      ?.map(({ exported, binding }) => `export const ${exported} = _Scope.${binding}`)
      .join('\n') ?? ''
    const apps = AST.appValueDeclarationsInFile(taoFile)
    const moduleCommands = taoFile.statements.filter(AST.isCommandDeclaration)
    const dataEntities = opts.dataEntities ?? taoFile.statements.filter(AST.isEntityDataDeclaration)
    const hasRuntimeStatements = taoFile.statements.some(statement =>
      AST.isGuardDefaultStatement(statement)
      || (AST.isEmittingRuntimeBinding(statement)
        && (!AST.isTypeDeclaration(statement) || isRuntimeConfigurableDeclaration(statement)))
    )
    if (!hasRuntimeStatements && !importLines && !scopeBindings && !exportLines && !bridgeTypes) {
      return gen`export {}`
    }
    const registry = apps.length === 0 ? gen.noop() : gen`
      export const TaoApps = {
        ${gen.list(apps, app => gen`${gen.jsLiteral(app.name)}: ${gen.Name({ name: `TaoApp_${app.name}` })},`)}
      } as const
      ${opts.selectedAppName ? gen`export default TaoApps[${gen.jsLiteral(opts.selectedAppName)}]` : gen.noop()}
    `
    return gen`
      import React from 'react'
      void React
      import TR from '@runtime/TR'

      ${gen.textLines(importLines)}

      ${
      apps.length > 0 && (opts.studio || activeFixtureStores().length > 0)
        ? gen`
          const useTaoGeneratedStudioFixture = TR.Studio.Environment.useFixture
          ${opts.studio ? gen`const useTaoGeneratedStudioScenario = TR.Studio.Environment.useScenario` : gen.noop()}
        `
        : gen.noop()
    }

      const _Scope: any = {}
      ${gen.textLines(scopeBindings)}
      ${gen.textLines(viewRegistrations)}

      ${
      (opts.emitDataCatalog ?? dataEntities.length > 0)
        ? Compile.DataCatalog(dataEntities, opts.dataAccess)
        : gen.noop()
    }
      ${Compile.OutlineTable(taoFile)}

      ${
      gen.list(inDeclarationOrder(taoFile.statements), statement => Compile.Statement(statement, opts), { newLines: 2 })
    }
      ${
      moduleCommands.length === 0
        ? gen.noop()
        : gen`TR.Interaction.RegisterCommands(${Compile.CommandTable(moduleCommands)})`
    }
      ${registry}
      ${gen.textLines(exportLines)}
      ${gen.textLines(configurationTypes)}
      ${gen.textLines(bridgeTypes)}
    `
  },
} as const

/**
 * inDeclarationOrder emits reusable nav and datasource types before everything else in the module.
 * A type compiles to a declaration built only from its imported implementation and its identity, so
 * it can go first; a value constructed from it — `datasource Feed = FeedSource { … }` — reads it
 * eagerly, so it must. Tao lets a file declare them in either order, and emitting in source order
 * turned a type written below its first use into `undefined` at runtime.
 */
function inDeclarationOrder(statements: readonly AST.Statement[]): AST.Statement[] {
  return [
    ...statements.filter(isRuntimeConfigurableDeclaration),
    ...statements.filter(statement => !isRuntimeConfigurableDeclaration(statement)),
  ]
}
