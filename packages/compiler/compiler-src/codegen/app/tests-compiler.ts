import { AST } from '@parser'
import { type Compiled, gen } from '../codegen-util'

export default {
  /** TestDeclaration compiles to no generated app output. */
  TestDeclaration(_test: AST.TestDeclaration): Compiled {
    return gen.noop()
  },

  /** RunStep compiles to no generated app output. */
  RunStep(_run: AST.RunStep): Compiled {
    return gen.noop()
  },

  /** BackTestStep compiles to no generated app output. */
  BackTestStep(_back: AST.BackTestStep): Compiled {
    return gen.noop()
  },

  /** AdvanceStep compiles only into test-plan IR. */
  AdvanceStep(_advance: AST.AdvanceStep): Compiled {
    return gen.noop()
  },

  /** PressTextStep compiles to no generated app output. */
  PressTextStep(_press: AST.PressTextStep): Compiled {
    return gen.noop()
  },

  TagPressStep(): Compiled {
    return gen.noop()
  },

  /** EnterTextStep compiles to no generated app output. */
  EnterTextStep(_enter: AST.EnterTextStep): Compiled {
    return gen.noop()
  },

  TagEnterStep(): Compiled {
    return gen.noop()
  },

  /** SubmitInputStep compiles to no generated app output. */
  SubmitInputStep(_submit: AST.SubmitInputStep): Compiled {
    return gen.noop()
  },

  TagSubmitStep(): Compiled {
    return gen.noop()
  },

  SelectStep(): Compiled {
    return gen.noop()
  },

  /** ExpectTextStep compiles to no generated app output. */
  ExpectTextStep(_expectation: AST.ExpectTextStep): Compiled {
    return gen.noop()
  },

  /** ExpectCheckboxStateStep compiles only into test-plan IR. */
  ExpectCheckboxStateStep(_expectation: AST.ExpectCheckboxStateStep): Compiled {
    return gen.noop()
  },

  /** ExpectInputValueStep compiles to no generated app output. */
  ExpectInputValueStep(_expectation: AST.ExpectInputValueStep): Compiled {
    return gen.noop()
  },

  TagInputValueExpectation(): Compiled {
    return gen.noop()
  },

  ExpectGroupStep(): Compiled {
    return gen.noop()
  },

  ExpectScopeStep(): Compiled {
    return gen.noop()
  },

  ExpectNavigationTitleStep(): Compiled {
    return gen.noop()
  },

  ExpectToolbarCommandStep(): Compiled {
    return gen.noop()
  },

  PressToolbarCommandStep(): Compiled {
    return gen.noop()
  },
} as const
