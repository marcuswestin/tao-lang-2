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
          ${gen.block(action, Compile.ActionStatement)}
        })
      })
    `
  },

  /** ActionExpression compiles an inline Tao action into a runtime action value. */
  ActionExpression(action: AST.ActionExpression): Compiled {
    return gen`
      TR.Action(() => {
        return TR.BlockScope(_Scope, _Scope => {
          ${gen.block(action, Compile.ActionStatement)}
        })
      })
    `
  },

  /** ActionParameterBinding binds one runtime action argument into the action-local scope. */
  ActionParameterBinding(parameter: ActionParameter): Compiled {
    return gen`${gen.scopeName({ name: Type.parameterName(parameter.parameter) })} = ${
      actionRuntimeParameterName(parameter.index)
    }`
  },

  /** ActionRuntimeParameter compiles one action callback parameter. */
  ActionRuntimeParameter(parameter: ActionParameter): Compiled {
    return gen`${actionRuntimeParameterName(parameter.index)}: ${Compile.ParameterType(parameter.parameter)}`
  },

  /** ActionStatement compiles one statement inside a Tao action body. */
  ActionStatement(statement: AST.ActionStatement): Compiled {
    return Switch.type(statement, {
      DoStatement: Compile.DoStatement,
      SetStatement: Compile.SetStatement,
      ToggleStatement: Compile.ToggleStatement,
    })
  },

  /** DoStatement compiles Tao action invocation. */
  DoStatement(invocation: AST.DoStatement): Compiled {
    return gen`TR.Do(${Compile.Expression(invocation.action)}${Compile.ActionArguments(invocation)})`
  },

  /** ActionArguments compiles action invocation argument expressions. */
  ActionArguments(invocation: AST.DoStatement): Compiled {
    return gen.join(actionInvocationArguments(invocation), argument => gen`, ${Compile.Argument(argument)}`, {
      separator: '',
    })
  },
} as const

function actionParameters(action: AST.ActionDeclaration): ActionParameter[] {
  return AST.parametersOf(action).map((parameter, index) => ({ index, parameter }))
}

function actionRuntimeParameterName(index: number): Compiled {
  return gen.Name({ name: `_TaoActionArg${index}` })
}

function actionInvocationArguments(invocation: AST.DoStatement): AST.Argument[] {
  const resolved = ASTUtils.resolveActionInvocation(invocation)
  if (!resolved.action) {
    Assert(AST.argumentsOf(invocation).length === 0, 'validated dynamic action invocation has no arguments')
    return []
  }
  Assert.defined(resolved.action, 'validated action invocation targets a named action')
  Assert(resolved.diagnostics.length === 0, 'validated action invocation has no binding diagnostics')
  return resolved.pairs.map(pair => pair.argument)
}
