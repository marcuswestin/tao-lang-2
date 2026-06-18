import { Type } from '@ast-utils'
import { AST } from '@parser'
import { Switch } from '@shared'
import { type Compiled, gen, genJoin, genList, genName, genScopeName } from '../codegen-util'
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
      ${genScopeName(action)} = TR.Action((${genJoin(parameters, Compile.ActionRuntimeParameter)}) => {
        return TR.BlockScope(_Scope, _Scope => {
          ${genList(parameters, Compile.ActionParameterBinding)}
          ${genList(action.block.statements, Compile.ActionStatement)}
        })
      })
    `
  },

  /** ActionExpression compiles an inline Tao action into a runtime action value. */
  ActionExpression(action: AST.ActionExpression): Compiled {
    return gen`
      TR.Action(() => {
        return TR.BlockScope(_Scope, _Scope => {
          ${genList(action.block.statements, Compile.ActionStatement)}
        })
      })
    `
  },

  /** ActionParameterBinding binds one runtime action argument into the action-local scope. */
  ActionParameterBinding(parameter: ActionParameter): Compiled {
    return gen`${genScopeName({ name: Type.parameterName(parameter.parameter) })} = ${
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
    })
  },

  /** DoStatement compiles Tao action invocation. */
  DoStatement(invocation: AST.DoStatement): Compiled {
    return gen`TR.Do(${Compile.Expression(invocation.action)}${Compile.ActionArguments(invocation)})`
  },

  /** ActionArguments compiles action invocation argument expressions. */
  ActionArguments(invocation: AST.DoStatement): Compiled {
    return genJoin(
      invocation.argumentList?.arguments ?? [],
      argument => gen`, ${Compile.Argument(argument)}`,
      { separator: '' },
    )
  },
} as const

function actionParameters(action: AST.ActionDeclaration): ActionParameter[] {
  return (action.parameterList?.parameters ?? []).map((parameter, index) => ({ index, parameter }))
}

function actionRuntimeParameterName(index: number): Compiled {
  return genName({ name: `_TaoActionArg${index}` })
}
