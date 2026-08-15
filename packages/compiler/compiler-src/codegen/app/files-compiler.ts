import { AST } from '@parser'
import { type Compiled, gen } from '../codegen-util'
import { Compile } from '../Compile'

type TaoFileCompileOptions = {
  configurationTypes?: string
  importLines?: string[]
  scopeBindings?: string[]
  exportedNames?: string[]
  selectedAppName?: string
}

export default {
  /** TaoFile compiles a parsed Tao file into a default React component module. */
  TaoFile(taoFile: AST.TaoFile, opts: TaoFileCompileOptions = {}): Compiled {
    const configurationTypes = opts.configurationTypes ?? ''
    const importLines = opts.importLines?.join('\n') ?? ''
    const scopeBindings = opts.scopeBindings?.join('\n') ?? ''
    const exportLines = opts.exportedNames?.map(name => `export const ${name} = _Scope.${name}`).join('\n') ?? ''
    const apps = AST.appValueDeclarationsInFile(taoFile)
    const dataEntities = taoFile.statements.filter(AST.isEntityDataDeclaration)
    const hasRuntimeStatements = taoFile.statements.some(statement =>
      AST.isAppDeclaration(statement) || AST.isEmittingRuntimeBinding(statement)
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

      // @ts-ignore RN is available to Tao inject blocks
      import * as RN from 'react-native'

      ${gen.textLines(importLines)}

      const _Scope: any = {}
      ${gen.textLines(scopeBindings)}

      ${dataEntities.length > 0 ? Compile.DataCatalog(dataEntities) : gen.noop()}

      ${gen.list(taoFile.statements, Compile.Statement, { newLines: 2 })}
      ${registry}
      ${gen.textLines(exportLines)}
      ${gen.textLines(configurationTypes)}
    `
  },
} as const
