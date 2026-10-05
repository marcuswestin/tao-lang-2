import { AST } from '@parser'
import { Assert } from '@shared'
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
  selectedStatements?: readonly AST.Statement[]
}

export const FilesCompiler = {
  /** TaoFile compiles a parsed Tao file into a default React component module. */
  TaoFile(taoFile: AST.TaoFile, opts: TaoFileCompileOptions = {}): Compiled {
    const statements = opts.selectedStatements ?? taoFile.statements
    const configurationTypes = opts.configurationTypes ?? ''
    const bridgeTypes = opts.bridgeTypes ?? ''
    const importLines = opts.importLines?.join('\n') ?? ''
    const scopeBindings = opts.scopeBindings?.join('\n') ?? ''
    const viewRegistrations = opts.viewRegistrations ?? ''
    const exportLines = opts.exportedBindings
      ?.map(({ exported, binding }) => `export const ${exported} = _Scope.${binding}`)
      .join('\n') ?? ''
    const apps = AST.appValueDeclarationsInFile(taoFile).filter(app => statements.includes(app))
    const moduleCommands = statements.filter(AST.isCommandDeclaration)
    const dataEntities = opts.dataEntities ?? statements.filter(AST.isEntityDataDeclaration)
    const hasRuntimeStatements = statements.some(statement =>
      AST.isEmittingRuntimeBinding(statement)
      && (!AST.isTypeDeclaration(statement) || isRuntimeConfigurableDeclaration(statement))
    )
    if (!hasRuntimeStatements && !importLines && !scopeBindings && !exportLines && !bridgeTypes) {
      return gen`export {}`
    }
    const sourcePath = AST.getDocument(taoFile).uri.fsPath
    const registry = apps.length === 0 ? gen.noop() : gen`
      export const TaoApps = {
        ${gen.list(apps, app => gen`${gen.jsLiteral(app.name)}: ${gen.Name({ name: `TaoApp_${app.name}` })},`)}
      } as const
      ${opts.selectedAppName ? gen`export default TaoApps[${gen.jsLiteral(opts.selectedAppName)}]` : gen.noop()}
    `
    // Module-scope hook aliases let Fast Refresh resolve them without forcing an app remount.
    return gen`
      import React from 'react'
      void React
      import TR from '@runtime/TR'

      ${gen.textLines(importLines)}

      ${
      opts.studio === true && opts.studioSourceEpochs !== undefined
        ? gen`const __tao_design_cohort__ = TR.Design.Cohort({
          path: ${gen.jsLiteral(sourcePath)},
          epoch: ${opts.studioSourceEpochs[sourcePath] ?? 0},
          designEpochs: ${gen.jsLiteral(opts.studioDesignEpochs ?? {})},
        })`
        : gen.noop()
    }

      ${apps.length > 0 ? gen`const useTaoGeneratedAgentCommands = TR.Agent.useCommands` : gen.noop()}
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
      ${Compile.OutlineTable(taoFile, statements)}

      ${gen.list(inDeclarationOrder(statements), statement => Compile.Statement(statement, opts), { newLines: 2 })}
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
 * inDeclarationOrder emits reusable types first, then defers a derived app until its same-file base
 * has initialized. Other statements keep source order, including values between an app and its base:
 * moving a base ahead of them could make its eager configuration read an uninitialized value.
 */
function inDeclarationOrder(statements: readonly AST.Statement[]): AST.Statement[] {
  const types = statements.filter(isRuntimeConfigurableDeclaration)
  const rest = statements.filter(statement => !isRuntimeConfigurableDeclaration(statement))
  const apps = new Set(rest.filter(AST.isAppValueDeclaration))
  const emitted = new Set<AST.AppValueDeclaration>()
  const waiting: AST.AppValueDeclaration[] = []
  const ordered: AST.Statement[] = [...types]
  const ready = (app: AST.AppValueDeclaration): boolean => {
    const value = app.value
    const base = value && (AST.isValueReference(value) || AST.isRefinementExpression(value))
      ? value.target.ref
      : undefined
    return !base || !AST.isAppValueDeclaration(base) || !apps.has(base) || emitted.has(base)
  }
  const drain = (): void => {
    let advanced = true
    while (advanced) {
      advanced = false
      const index = waiting.findIndex(ready)
      if (index >= 0) {
        const [app] = waiting.splice(index, 1)
        ordered.push(app!)
        emitted.add(app!)
        advanced = true
      }
    }
  }
  for (const statement of rest) {
    if (!AST.isAppValueDeclaration(statement)) {
      ordered.push(statement)
      continue
    }
    waiting.push(statement)
    drain()
  }
  Assert(waiting.length === 0, 'validated app derivation is acyclic')
  return ordered
}
