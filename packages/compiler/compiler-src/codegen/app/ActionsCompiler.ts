import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Assert, Switch } from '@shared'
import { type Compiled, gen, resolveRef } from '../codegen-util'
import { Compile } from '../Compile'
import {
  actionBlockContainsRespond,
  actionBlockRequiresAsync,
  actionInvocationRequiresAsync,
} from './action-control-flow'
import { foreignActionBindingName } from './injection-plan'

type ActionParameter = {
  index: number
  parameter: AST.ParameterDeclaration
}

export const ActionsCompiler = {
  /** ActionDeclaration compiles a named Tao action into a runtime action value. */
  ActionDeclaration(action: AST.ActionDeclaration): Compiled {
    if (action.foreign) {
      return compileForeignAction(action)
    }
    const parameters = actionParameters(action)
    const asyncKeyword = actionBlockRequiresAsync(action.block) ? gen`async ` : gen``
    const metadata = [
      { property: 'title', fill: AST.declarationSlotFillNamed(action, 'Title') },
      { property: 'description', fill: AST.declarationSlotFillNamed(action, 'Description') },
      { property: 'summary', fill: AST.declarationSlotFillNamed(action, 'Summary') },
    ].filter((entry): entry is { property: string; fill: AST.DeclarationSlotFill & { value: AST.Expression } } =>
      entry.fill?.value !== undefined
    )
    return gen`
      ${gen.scopeName(action)} = TR.Action(${asyncKeyword}(${gen.join(parameters, Compile.ActionRuntimeParameter)}) => {
        return TR.BlockScope(_Scope, ${asyncKeyword}_Scope => {
          ${gen.list(parameters, Compile.ActionParameterBinding)}
          ${Compile.ActionBlockBody(action.block)}
        })
      }, {
        name: ${gen.jsLiteral(action.name)},
        ${actionBlockContainsRespond(action.block) ? gen`interrupt: true,` : gen``}
        ${
      gen.list(metadata, entry =>
        gen`${entry.property}: (${
          gen.join(parameters, Compile.ActionRuntimeParameter)
        }) => TR.BlockScope(_Scope, _Scope => {
            ${gen.list(parameters, Compile.ActionParameterBinding)}
            return ${Compile.Expression(entry.fill.value)}
          }),`)
    }
      })
    `
  },

  /** CommandDeclaration binds an intent call and live occurrence metadata for host-owned chrome. */
  CommandDeclaration(command: AST.CommandDeclaration): Compiled {
    const action = resolveRef(command.action)
    const resolved = ASTUtils.resolveArgumentBindings(action, command)
    Assert(resolved.diagnostics.length === 0, 'validated command has no binding diagnostics')
    const parameters = AST.parametersOf(action)
    const argumentsByParameter = new Map(resolved.pairs.map(pair => [pair.parameter, pair.argument]))
    const lastProvidedIndex = Math.max(...resolved.pairs.map(pair => parameters.indexOf(pair.parameter)), -1)
    const arguments_ = parameters.slice(0, lastProvidedIndex + 1).map(parameter => {
      const argument = argumentsByParameter.get(parameter)
      return argument ? Compile.Argument(argument) : gen`undefined`
    })
    const fill = (name: string) => command.metadata?.fills.find(candidate => candidate.name === name)?.value
    const label = fill('Label')
    const icon = fill('Icon')
    const key = fill('Key')
    const enabled = fill('Enabled')
    return gen`${gen.scopeName(command)} = TR.Navigation.Command({
      action: { evaluate: () => ${gen.scopeName(action)}.evaluate() },
      arguments: [${gen.join(arguments_, argument => argument)}],
      intentTitle: () => TR.ActionTitle(${gen.scopeName(action)}, [${gen.join(arguments_, argument => argument)}]),
      name: ${gen.jsLiteral(command.name)},
      ${label ? gen`label: () => ${Compile.Expression(label)},` : gen.noop()}
      ${icon ? gen`icon: () => ${Compile.Expression(icon)},` : gen.noop()}
      ${key ? gen`key: () => ${Compile.Expression(key)},` : gen.noop()}
      ${enabled ? gen`enabled: () => ${Compile.Expression(enabled)},` : gen.noop()}
    })`
  },

  /** ActionExpression compiles an inline Tao action into a runtime action value. */
  ActionExpression(action: AST.ActionExpression): Compiled {
    const asyncKeyword = actionBlockRequiresAsync(action.block) ? gen`async ` : gen``
    return gen`
      TR.Action(${asyncKeyword}() => {
        return TR.BlockScope(_Scope, ${asyncKeyword}_Scope => {
          ${Compile.ActionBlockBody(action.block)}
        })
      }${actionBlockContainsRespond(action.block) ? gen`, { interrupt: true }` : gen``})
    `
  },

  /** ActionParameterBinding binds one runtime action argument into the action-local scope. */
  ActionParameterBinding(parameter: ActionParameter): Compiled {
    const name = { name: Type.parameterName(parameter.parameter) }
    const runtimeParameter = actionRuntimeParameterName(parameter.index)
    return parameter.parameter.defaultValue === undefined
      ? gen`${gen.scopeName(name)} = ${runtimeParameter}`
      : gen`${gen.scopeName(name)} = ${runtimeParameter} ?? ${Compile.Expression(parameter.parameter.defaultValue)}`
  },

  /** ActionRuntimeParameter compiles one action callback parameter. */
  ActionRuntimeParameter(parameter: ActionParameter): Compiled {
    return gen`${actionRuntimeParameterName(parameter.index)}${
      parameter.parameter.defaultValue === undefined ? '' : '?'
    }: ${Compile.ParameterType(parameter.parameter)}`
  },

  /** ActionStatement compiles one statement inside a Tao action body. */
  ActionStatement(statement: AST.ActionStatement): Compiled {
    return Switch.type(statement, {
      AsyncActionStatement: Compile.AsyncActionStatement,
      CreateStatement: Compile.CreateStatement,
      AskStatement: Compile.AskStatement,
      ContextualPresentStatement: Compile.ContextualPresentStatement,
      DeleteStatement: Compile.DeleteStatement,
      DeclarationSlotFill: Compile.DeclarationSlotFill,
      DismissStatement: Compile.DismissStatement,
      DoStatement: Compile.DoStatement,
      GuardActionStatement: Compile.GuardActionStatement,
      IfActionStatement: Compile.IfActionStatement,
      ReplaceStatement: Compile.ReplaceStatement,
      RespondStatement: Compile.RespondStatement,
      SelectionActivateStatement: Compile.SelectionActivateStatement,
      SetStatement: Compile.SetStatement,
      ToggleStatement: Compile.ToggleStatement,
      UpdateStatement: Compile.UpdateStatement,
      FailStatement: Compile.FailStatement,
    })
  },

  /** ActionBlockBody compiles one callback-owned action block. */
  ActionBlockBody(block: AST.ActionBlock | undefined): Compiled {
    return gen.list(block?.statements ?? [], Compile.ActionStatement)
  },

  /** DeclarationSlotFill is metadata consumed by its owning action or view compiler. */
  DeclarationSlotFill(): Compiled {
    return gen.noop()
  },

  /** AsyncActionStatement launches an isolated action sub-block without delaying its caller. */
  AsyncActionStatement(statement: AST.AsyncActionStatement): Compiled {
    return gen`TR.Async(() =>
      TR.BlockScope(_Scope, async _Scope => {
        ${Compile.ActionBlockBody(statement.block)}
      })
    )`
  },

  /** DoStatement compiles Tao action invocation. */
  DoStatement(invocation: AST.DoStatement): Compiled {
    const awaitKeyword = actionInvocationRequiresAsync(invocation) ? gen`await ` : gen``
    return gen`${awaitKeyword}TR.Do(${Compile.Expression(invocation.action)}${Compile.ActionArguments(invocation)})`
  },

  /** FailStatement aborts the joined action transaction with one declared case and sentence. */
  FailStatement(statement: AST.FailStatement): Compiled {
    const failureCase = resolveRef(statement.case)
    return gen`TR.Fail(${Compile.ValueDeclarationReference(failureCase)}, ${gen.jsLiteral(statement.sentence)})`
  },

  /** AskStatement suspends its action and binds the response owned by this presented occurrence. */
  AskStatement(statement: AST.AskStatement): Compiled {
    const view = resolveRef(statement.view)
    const resolved = ASTUtils.resolveArgumentBindings(view, statement)
    Assert(resolved.diagnostics.length === 0, 'validated ask has no binding diagnostics')
    return gen`${gen.scopeName(statement)} = await TR.Navigation.Ask(
      _ViewProps.__tao,
      ${Compile.ViewValue(view)},
      { ${gen.list(resolved.pairs, Compile.NavigationArgument)} },
    )`
  },

  /** RespondStatement settles only the responding occurrence inherited by this render tree. */
  RespondStatement(statement: AST.RespondStatement): Compiled {
    const response = statement.case?.ref
    return gen`TR.Navigation.Respond(
      _ViewProps.__tao${response ? gen`, ${Compile.ValueDeclarationReference(response)}` : ''},
    )`
  },

  /** ActionArguments compiles action invocation argument expressions. */
  ActionArguments(invocation: AST.DoStatement): Compiled {
    return gen.join(actionInvocationArguments(invocation), argument => gen`, ${argument}`, {
      separator: '',
    })
  },

  /** ToggleStatement inverts a validated boolean state through the runtime. */
  ToggleStatement(statement: AST.ToggleStatement): Compiled {
    const state = statement.target.ref
    Assert.defined(state, 'validated toggle targets a state')
    return gen`TR.Toggle(${gen.scopeName(state)})`
  },

  /** GuardActionStatement stops only its enclosing action-block callback after a match. */
  GuardActionStatement(statement: AST.GuardActionStatement): Compiled {
    return gen`if (await TR.GuardAction(${Compile.Expression(statement.subject)}, [
      ${
      gen.list(
        ASTUtils.guardBranches(statement),
        branch =>
          gen`[${gen.jsLiteral(branch.case)}, async _TaoCasePayload => TR.BlockScope(_Scope, async _Scope => {
          ${branch.payload ? gen`${gen.scopeName(branch.payload)} = _TaoCasePayload` : ''}
          ${Compile.ActionBlockBody(branch.block)}
        })],`,
      )
    }
    ])) return`
  },

  /** IfActionStatement lazily executes one action sub-block without terminating its caller. */
  IfActionStatement(statement: AST.IfActionStatement): Compiled {
    return gen`await TR.If(${Compile.Expression(statement.condition)}, async () =>
      TR.BlockScope(_Scope, async _Scope => {
        ${Compile.ActionBlockBody(statement.block)}
      })
    )`
  },
} as const

function actionParameters(action: AST.ActionDeclaration): ActionParameter[] {
  return AST.parametersOf(action).map((parameter, index) => ({ index, parameter }))
}

function actionRuntimeParameterName(index: number): Compiled {
  return gen.Name({ name: `_TaoActionArg${index}` })
}

function actionInvocationArguments(invocation: AST.DoStatement): Compiled[] {
  const resolved = ASTUtils.resolveActionInvocation(invocation)
  if (!resolved.action) {
    // Dynamic callbacks declare positional action(...) signatures, so preserve the
    // caller's source order instead of applying named-action type binding.
    return AST.argumentsOf(invocation).map(Compile.Argument)
  }
  Assert.defined(resolved.action, 'validated action invocation targets a named action')
  Assert(resolved.diagnostics.length === 0, 'validated action invocation has no binding diagnostics')
  const parameters = AST.parametersOf(resolved.action)
  const argumentsByParameter = new Map(resolved.pairs.map(pair => [pair.parameter, pair.argument]))
  const lastProvidedIndex = Math.max(...resolved.pairs.map(pair => parameters.indexOf(pair.parameter)), -1)
  return parameters.slice(0, lastProvidedIndex + 1).map(parameter => {
    const argument = argumentsByParameter.get(parameter)
    return argument ? Compile.Argument(argument) : gen`undefined`
  })
}

function compileForeignAction(action: AST.ActionDeclaration): Compiled {
  const foreign = action.foreign
  Assert.defined(foreign, 'foreign action has an implementation')
  const implementation = { name: foreignActionBindingName(action) }
  const parameters = actionParameters(action)
  const requiredArguments = parameters.filter(({ parameter }) => parameter.defaultValue === undefined).length
  const adaptedImplementation = parameters.some(({ parameter }) => parameter.defaultValue !== undefined)
    ? gen`(${gen.join(parameters, parameter => actionRuntimeParameterName(parameter.index))}) =>
      TR.BlockScope(_Scope, _Scope => {
        ${gen.list(parameters, compileForeignActionParameterBinding)}
        return ${gen.Name(implementation)}(${
      gen.join(parameters, ({ parameter }) => {
        const name = { name: Type.parameterName(parameter) }
        return gen`${gen.scopeName(name)}.evaluate().jsValue`
      })
    })
      })`
    : gen.Name(implementation)
  return gen`${gen.scopeName(action)} = TR.ForeignAction(
    ${adaptedImplementation},
    ${gen.jsLiteral(action.name)},
    [${
    gen.join(foreign.failures, failure =>
      gen`{
      case: ${Compile.ValueDeclarationReference(resolveRef(failure.case))},
      sentence: ${gen.jsLiteral(failure.sentence)},
    }`)
  }],
    { ${action.runsLatest ? gen`runs: "latest", ` : gen``}requiredArguments: ${requiredArguments} },
  )`
}

function compileForeignActionParameterBinding(parameter: ActionParameter): Compiled {
  const runtimeParameter = actionRuntimeParameterName(parameter.index)
  const name = { name: Type.parameterName(parameter.parameter) }
  return parameter.parameter.defaultValue === undefined
    ? gen`${gen.scopeName(name)} = TR.Value(${runtimeParameter})`
    : gen`${gen.scopeName(name)} = ${runtimeParameter} == null
      ? ${Compile.Expression(parameter.parameter.defaultValue)}
      : TR.Value(${runtimeParameter})`
}
