import { AST } from '@parser'
import { type Compiled, gen } from '../codegen-util'
import { Compile } from '../Compile'

type TaoFileCompileOptions = {
  importLines?: string[]
  scopeBindings?: string[]
  exportedNames?: string[]
}

export default {
  /** TaoFile compiles a parsed Tao file into a default React component module. */
  TaoFile(taoFile: AST.TaoFile, opts: TaoFileCompileOptions = {}): Compiled {
    const importLines = opts.importLines?.join('\n') ?? ''
    const scopeBindings = opts.scopeBindings?.join('\n') ?? ''
    const exportLines = opts.exportedNames?.map(name => `export const ${name} = _Scope.${name}`).join('\n') ?? ''
    return gen`
      import React from 'react'
      import TR from '@runtime/TR'

      // @ts-ignore RN is available to Tao inject blocks
      import * as RN from 'react-native'

      ${gen.textLines(importLines)}

      const _Scope: any = {}
      ${gen.textLines(scopeBindings)}

      ${gen.list(taoFile.statements, Compile.Statement, { newLines: 2 })}
      ${gen.textLines(exportLines)}
    `
  },
} as const
