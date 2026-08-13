import { AST } from '@parser'
import { Switch } from '@shared'
import { type Compiled, gen } from '../codegen-util'
import { Compile } from '../Compile'

export const StatementsCompiler = {
  /** Statement compiles one Tao statement. */
  Statement(statement: AST.Statement): Compiled {
    return Switch.type(statement, {
      AliasDeclaration: Compile.AliasDeclaration,
      AppDeclaration: Compile.App,
      ActionDeclaration: Compile.ActionDeclaration,
      BackTestStep: Compile.BackTestStep,
      CheckDeclaration: Compile.CheckDeclaration,
      EntityDataDeclaration: Compile.EntityDataDeclaration,
      EntityQueryDeclaration: Compile.EntityQueryDeclaration,
      EnumDeclaration: Compile.EnumDeclaration,
      DataStatusStep: Compile.DataStatusStep,
      EnterTextStep: Compile.EnterTextStep,
      TagEnterStep: Compile.TagEnterStep,
      EventHandler: Compile.EventHandler,
      ExpectInputValueStep: Compile.ExpectInputValueStep,
      TagInputValueExpectation: Compile.TagInputValueExpectation,
      ExpectTextStep: Compile.ExpectTextStep,
      ExpectGroupStep: Compile.ExpectGroupStep,
      ExpectScopeStep: Compile.ExpectScopeStep,
      ForStatement: Compile.ForStatement,
      FunctionDeclaration: Compile.FunctionDeclaration,
      GuardRenderStatement: statement => Compile.GuardRenderStatement(statement, []),
      IfRenderStatement: Compile.IfRenderStatement,
      WhenRenderStatement: Compile.WhenRenderStatement,
      Injection: Compile.Injection,
      LayoutDeclaration: Compile.LayoutDeclaration,
      PressTextStep: Compile.PressTextStep,
      TagPressStep: Compile.TagPressStep,
      ProjectDeclaration: Compile.ProjectDeclaration,
      RenderStatement: Compile.RenderStatement,
      RunStep: Compile.RunStep,
      StateDeclaration: Compile.StateDeclaration,
      SubmitInputStep: Compile.SubmitInputStep,
      TagSubmitStep: Compile.TagSubmitStep,
      SelectStep: Compile.SelectStep,
      TagStatement: Compile.TagStatement,
      TestDeclaration: Compile.TestDeclaration,
      TypeDeclaration: Compile.TypeDeclaration,
      UiDeclaration: Compile.UiDeclaration,
      UseStatement: Compile.UseStatement,
      ViewDeclaration: Compile.ViewDeclaration,
      ViewRender: Compile.ViewRender,
    })
  },

  /** TypeDeclaration emits no runtime code; Tao named types are compile-time only. */
  TypeDeclaration(): Compiled {
    return gen.noop()
  },

  /** EventHandler emits only as an enclosing render invocation prop. */
  EventHandler(): Compiled {
    return gen.noop()
  },

  /** TagStatement is consumed as private metadata by the following render or loop row root. */
  TagStatement(): Compiled {
    return gen.noop()
  },
} as const
