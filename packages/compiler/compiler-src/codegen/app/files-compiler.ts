import { AST } from '@parser'
import { type CodegenOptions, type Compiled, gen } from '../codegen-util'
import { Compile } from '../Compile'
import { isRuntimeConfigurableDeclaration } from './configuration-compiler'

type TaoFileCompileOptions = CodegenOptions & {
  configurationTypes?: string
  dataEntities?: readonly AST.EntityDataDeclaration[]
  emitDataCatalog?: boolean
  importLines?: string[]
  scopeBindings?: string[]
  exportedBindings?: ReadonlyArray<{ exported: string; binding: string }>
  viewRegistrations?: string
}

export default {
  /** TaoFile compiles a parsed Tao file into a default React component module. */
  TaoFile(taoFile: AST.TaoFile, opts: TaoFileCompileOptions = {}): Compiled {
    const configurationTypes = opts.configurationTypes ?? ''
    const importLines = opts.importLines?.join('\n') ?? ''
    const scopeBindings = opts.scopeBindings?.join('\n') ?? ''
    const viewRegistrations = opts.viewRegistrations ?? ''
    const exportLines = opts.exportedBindings
      ?.map(({ exported, binding }) => `export const ${exported} = _Scope.${binding}`)
      .join('\n') ?? ''
    const apps = AST.appValueDeclarationsInFile(taoFile)
    const dataEntities = opts.dataEntities ?? taoFile.statements.filter(AST.isEntityDataDeclaration)
    const hasRuntimeStatements = taoFile.statements.some(statement =>
      AST.isEmittingRuntimeBinding(statement)
      && (!AST.isTypeDeclaration(statement) || isRuntimeConfigurableDeclaration(statement))
    )
    if (!hasRuntimeStatements && !importLines && !scopeBindings && !exportLines) {
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

      const _Scope: any = {}
      ${gen.textLines(scopeBindings)}
      ${gen.textLines(viewRegistrations)}

      ${(opts.emitDataCatalog ?? dataEntities.length > 0) ? Compile.DataCatalog(dataEntities) : gen.noop()}

      ${gen.list(taoFile.statements, statement => Compile.Statement(statement, opts), { newLines: 2 })}
      ${registry}
      ${gen.textLines(exportLines)}
      ${gen.textLines(configurationTypes)}
    `
  },
} as const
