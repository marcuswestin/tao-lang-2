import { AST } from '@parser'
import { Switch } from '@shared'
import { type CodegenOptions, type Compiled, gen } from '../codegen-util'
import { Compile } from '../Compile'
import { isRuntimeConfigurableDeclaration } from './ConfigurationCompiler'

export const StatementsCompiler = {
  /** Statement compiles one Tao statement. */
  Statement(statement: AST.Statement, options: CodegenOptions = {}): Compiled {
    return Switch.type(statement, {
      AliasDeclaration: value => Compile.AliasDeclaration(value, options),
      AppDeclaration: value => Compile.App(value, options),
      ActionDeclaration: Compile.ActionDeclaration,
      AsyncActionStatement: Compile.AsyncActionStatement,
      AdvanceStep: Compile.AdvanceStep,
      BackTestStep: Compile.BackTestStep,
      RelaunchStep: Compile.RelaunchStep,
      CommandDeclaration: Compile.CommandDeclaration,
      DeclarationSlotFill: Compile.DeclarationSlotFill,
      EntityDataDeclaration: Compile.EntityDataDeclaration,
      EntityQueryDeclaration: Compile.EntityQueryDeclaration,
      DatasourceDeclaration: Compile.PrimitiveValueDeclaration,
      DesignDeclaration: value => Compile.DesignDeclaration(value, options),
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
      FixtureDeclaration: Compile.FixtureDeclaration,
      ExpectToolbarCommandStep: Compile.ExpectToolbarCommandStep,
      ForStatement: value => Compile.ForStatement(value, options),
      FunctionDeclaration: Compile.FunctionDeclaration,
      GuardDefaultStatement: value => Compile.GuardDefaultStatement(value, options),
      GuardRenderStatement: value => Compile.GuardRenderStatement(value, [], options),
      IfRenderStatement: value => Compile.IfRenderStatement(value, options),
      WhenRenderStatement: value => Compile.WhenRenderStatement(value, options),
      Injection: Compile.Injection,
      LoopSelectHandler: Compile.LoopSelectHandler,
      NavDeclaration: Compile.PrimitiveValueDeclaration,
      PressTextStep: Compile.PressTextStep,
      PressWordStep: Compile.PressWordStep,
      InteractionWordStep: Compile.InteractionWordStep,
      PressToolbarCommandStep: Compile.PressToolbarCommandStep,
      TagPressStep: Compile.TagPressStep,
      ProjectDeclaration: Compile.ProjectDeclaration,
      PrimitiveDeclaration: Compile.PrimitiveDeclaration,
      RenderStatement: value => Compile.RenderStatement(value, options),
      RenderSlotDeclaration: Compile.RenderSlotDeclaration,
      RenderSlotUse: Compile.RenderSlotUse,
      CallerContentStatement: Compile.CallerContentStatement,
      RunStep: Compile.RunStep,
      ScenarioGroupDeclaration: Compile.ScenarioGroupDeclaration,
      StateDeclaration: Compile.StateDeclaration,
      SubmitInputStep: Compile.SubmitInputStep,
      TagSubmitStep: Compile.TagSubmitStep,
      SelectStep: Compile.SelectStep,
      ExpectInteractionStep: Compile.ExpectInteractionStep,
      TagStatement: Compile.TagStatement,
      TestDeclaration: Compile.TestDeclaration,
      TypeDeclaration: Compile.TypeDeclaration,
      UsePackageStatement: Compile.UsePackageStatement,
      UseStatement: Compile.UseStatement,
      ViewDeclaration: value => Compile.ViewDeclaration(value, options),
      ViewCommandExclusion: Compile.ViewCommandExclusion,
      ViewRender: value => Compile.ViewRender(value, options),
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

  /** FixtureDeclaration is Studio/test setup metadata and emits no production app binding. */
  FixtureDeclaration(): Compiled {
    return gen.noop()
  },

  /** ScenarioGroupDeclaration is Studio/review metadata and emits no production app binding. */
  ScenarioGroupDeclaration(): Compiled {
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
