import { AST } from '@parser'
import { type Compiled, gen, genList } from '../codegen-util'
import { Compile } from '../Compile'

export default {
  /** CompileTaoFile compiles a parsed Tao file into a default React component module. */
  CompileTaoFile(taoFile: AST.TaoFile): Compiled {
    return gen`
      import React from 'react'
      import * as RN from 'react-native'
      import TR from '@runtime/TR'

      ${genList(taoFile.statements, Compile.Statement, { newLines: 2 })}
    `
  },
} as const
