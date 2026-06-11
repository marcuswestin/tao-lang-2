import { AST } from '@parser'
import { type Compiled, gen, genList, genTextLines } from '../codegen-util'
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
      import * as RN from 'react-native'
      import TR from '@runtime/TR'
      ${genTextLines(importLines)}

      TR.setReactNativeRuntime(RN)
      const _Scope: any = {}
      ${genTextLines(scopeBindings)}

      ${genList(taoFile.statements, Compile.Statement, { newLines: 2 })}
      ${genTextLines(exportLines)}
    `
  },
} as const
