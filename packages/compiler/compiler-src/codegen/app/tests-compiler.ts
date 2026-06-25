import { AST } from '@parser'
import { type Compiled, gen } from '../codegen-util'

export default {
  /** TestDeclaration compiles to no generated app output. */
  TestDeclaration(_test: AST.TestDeclaration): Compiled {
    return gen.noop()
  },

  /** CheckDeclaration compiles to no generated app output. */
  CheckDeclaration(_check: AST.CheckDeclaration): Compiled {
    return gen.noop()
  },

  /** RunStep compiles to no generated app output. */
  RunStep(_run: AST.RunStep): Compiled {
    return gen.noop()
  },

  /** PressTextStep compiles to no generated app output. */
  PressTextStep(_press: AST.PressTextStep): Compiled {
    return gen.noop()
  },

  /** ExpectTextStep compiles to no generated app output. */
  ExpectTextStep(_expectation: AST.ExpectTextStep): Compiled {
    return gen.noop()
  },
} as const
