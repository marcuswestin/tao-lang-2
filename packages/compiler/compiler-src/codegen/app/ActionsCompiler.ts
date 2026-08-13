import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Assert, Switch } from '@shared'
import { type Compiled, gen } from '../codegen-util'
import { Compile } from '../Compile'

type ActionParameter = {
  index: number
  parameter: AST.ParameterDeclaration
}

export const ActionsCompiler = {
  /** ActionDeclaration compiles a named Tao action into a runtime action value. */
  ActionDeclaration(action: AST.ActionDeclaration): Compiled {
    const parameters = actionParameters(action)
    return gen`
      ${gen.scopeName(action)} = TR.Action((${gen.join(parameters, Compile.ActionRuntimeParameter)}) => {
        return TR.BlockScope(_Scope, _Scope => {
          ${gen.list(parameters, Compile.ActionParameterBinding)}
          ${Compile.ActionBlockBody(action.block)}
        })
      })
    `
  },

  /** ActionExpression compiles an inline Tao action into a runtime action value. */
  ActionExpression(action: AST.ActionExpression): Compiled {
    return gen`
      TR.Action(() => {
        return TR.BlockScope(_Scope, _Scope => {
          ${Compile.ActionBlockBody(action.block)}
        })
      })
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
      CreateStatement: Compile.CreateStatement,
      ContextualPresentStatement: Compile.ContextualPresentStatement,
      DeleteStatement: Compile.DeleteStatement,
      DismissStatement: Compile.DismissStatement,
      DoStatement: Compile.DoStatement,
      GuardActionStatement: Compile.GuardActionStatement,
      IfActionStatement: Compile.IfActionStatement,
      ReplaceStatement: Compile.ReplaceStatement,
      SetStatement: Compile.SetStatement,
      ToggleStatement: Compile.ToggleStatement,
      UpdateStatement: Compile.UpdateStatement,
    })
  },

  /** ActionBlockBody compiles one callback-owned action block. */
  ActionBlockBody(block: AST.ActionBlock | undefined): Compiled {
    return gen.list(block?.statements ?? [], Compile.ActionStatement)
  },

  /** DoStatement compiles Tao action invocation. */
  DoStatement(invocation: AST.DoStatement): Compiled {
    return gen`TR.Do(${Compile.Expression(invocation.action)}${Compile.ActionArguments(invocation)})`
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
    return gen`if (TR.GuardAction(${Compile.Expression(statement.subject)}, [
      ${
      gen.list(
        guardActionBranches(statement),
        branch =>
          gen`[${gen.jsLiteral(branch.case)}, _TaoCasePayload => TR.BlockScope(_Scope, _Scope => {
          ${branch.payload ? gen`${gen.scopeName(branch.payload)} = _TaoCasePayload` : ''}
          ${Compile.ActionBlockBody(branch.block)}
        })],`,
      )
    }
    ])) return`
  },

  /** IfActionStatement lazily executes one action sub-block without terminating its caller. */
  IfActionStatement(statement: AST.IfActionStatement): Compiled {
    return gen`TR.If(${Compile.Expression(statement.condition)}, () =>
      TR.BlockScope(_Scope, _Scope => {
        ${Compile.ActionBlockBody(statement.block)}
      })
    )`
  },
} as const

function guardActionBranches(statement: AST.GuardActionStatement): AST.GuardActionBranch[] {
  return statement.caseBlock?.branches ?? (statement.single ? [statement.single] : [])
}

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
