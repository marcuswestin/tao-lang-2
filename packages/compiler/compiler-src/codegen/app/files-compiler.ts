import { AST } from '@parser'
import { type Compiled, gen, genList } from '../codegen-util'
import { Compile } from '../Compile'

export default {
  /** TaoFile compiles a parsed Tao file into a default React component module. */
  TaoFile(taoFile: AST.TaoFile): Compiled {
    return gen`
      import React from 'react'
      import * as RN from 'react-native'
      import TR from '@runtime/TR'

      const _Scope: any = {}

      ${genList(taoFile.statements, Compile.Statement, { newLines: 2 })}
    `
  },
} as const
