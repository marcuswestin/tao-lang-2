import { AST } from '@parser'
import { Switch } from '@shared'
import { type Compiled, gen } from '../codegen-util'
import { Compile } from '../Compile'
import { isRuntimeConfigurableDeclaration } from './configuration-compiler'

export const StatementsCompiler = {
  /** Statement compiles one Tao statement. */
  Statement(statement: AST.Statement): Compiled {
    return Switch.type(statement, {
      AliasDeclaration: Compile.AliasDeclaration,
      AppDeclaration: Compile.App,
      ActionDeclaration: Compile.ActionDeclaration,
      AsyncActionStatement: Compile.AsyncActionStatement,
      AdvanceStep: Compile.AdvanceStep,
      BackTestStep: Compile.BackTestStep,
      CommandDeclaration: Compile.CommandDeclaration,
      DeclarationSlotFill: Compile.DeclarationSlotFill,
      EntityDataDeclaration: Compile.EntityDataDeclaration,
      EntityQueryDeclaration: Compile.EntityQueryDeclaration,
      DatasourceDeclaration: Compile.PrimitiveValueDeclaration,
      DesignDeclaration: Compile.DesignDeclaration,
      EnterTextStep: Compile.EnterTextStep,
      TagEnterStep: Compile.TagEnterStep,
      EventHandler: Compile.EventHandler,
      ExpectCheckboxStateStep: Compile.ExpectCheckboxStateStep,
      ExpectInputValueStep: Compile.ExpectInputValueStep,
      TagInputValueExpectation: Compile.TagInputValueExpectation,
      ExpectTextStep: Compile.ExpectTextStep,
      ExpectGroupStep: Compile.ExpectGroupStep,
      ExpectNavigationTitleStep: Compile.ExpectNavigationTitleStep,
      ExpectScopeStep: Compile.ExpectScopeStep,
      ExpectToolbarCommandStep: Compile.ExpectToolbarCommandStep,
      ForStatement: Compile.ForStatement,
      FunctionDeclaration: Compile.FunctionDeclaration,
      GuardRenderStatement: statement => Compile.GuardRenderStatement(statement, []),
      IfRenderStatement: Compile.IfRenderStatement,
      WhenRenderStatement: Compile.WhenRenderStatement,
      Injection: Compile.Injection,
      LoopSelectHandler: Compile.LoopSelectHandler,
      NavDeclaration: Compile.PrimitiveValueDeclaration,
      PressTextStep: Compile.PressTextStep,
      PressToolbarCommandStep: Compile.PressToolbarCommandStep,
      TagPressStep: Compile.TagPressStep,
      ProjectDeclaration: Compile.ProjectDeclaration,
      PrimitiveDeclaration: Compile.PrimitiveDeclaration,
      RenderStatement: Compile.RenderStatement,
      RenderSlotDeclaration: Compile.RenderSlotDeclaration,
      RenderSlotUse: Compile.RenderSlotUse,
      CallerContentStatement: Compile.CallerContentStatement,
      RunStep: Compile.RunStep,
      StateDeclaration: Compile.StateDeclaration,
      SubmitInputStep: Compile.SubmitInputStep,
      TagSubmitStep: Compile.TagSubmitStep,
      SelectStep: Compile.SelectStep,
      TagStatement: Compile.TagStatement,
      TestDeclaration: Compile.TestDeclaration,
      TypeDeclaration: Compile.TypeDeclaration,
      UsePackageStatement: Compile.UsePackageStatement,
      UseStatement: Compile.UseStatement,
      ViewDeclaration: Compile.ViewDeclaration,
      ViewRender: Compile.ViewRender,
    })
  },

  /** TypeDeclaration emits runtime code only for case sets and configurable types. */
  TypeDeclaration(declaration: AST.TypeDeclaration): Compiled {
    if (declaration.aliasTarget) {
      return gen.noop()
    }
    if (AST.isCaseSetTypeExpression(declaration.type)) {
      return Compile.CaseSetDeclaration(declaration)
    }
    return isRuntimeConfigurableDeclaration(declaration)
      ? Compile.ConfigurableDeclaration(declaration)
      : gen.noop()
  },

  /** PrimitiveDeclaration is parsed semantic input and emits no runtime binding. */
  PrimitiveDeclaration(): Compiled {
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

  /** RenderSlotDeclaration is compile-time frame metadata consumed by slot uses. */
  RenderSlotDeclaration(): Compiled {
    return gen.noop()
  },
} as const
