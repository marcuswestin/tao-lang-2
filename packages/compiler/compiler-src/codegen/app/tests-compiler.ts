import { AST } from '@parser'
import { type Compiled, genNoop } from '../codegen-util'

export default {
  /** TestDeclaration compiles to no generated app output. */
  TestDeclaration(_test: AST.TestDeclaration): Compiled {
    return genNoop()
  },

  /** CheckDeclaration compiles to no generated app output. */
  CheckDeclaration(_check: AST.CheckDeclaration): Compiled {
    return genNoop()
  },

  /** RunStep compiles to no generated app output. */
  RunStep(_run: AST.RunStep): Compiled {
    return genNoop()
  },

  /** ExpectTextStep compiles to no generated app output. */
  ExpectTextStep(_expectation: AST.ExpectTextStep): Compiled {
    return genNoop()
  },
} as const
