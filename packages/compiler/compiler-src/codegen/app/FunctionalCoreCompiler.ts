import { Type } from '@ast-utils'
import { AST } from '@parser'
import { Switch } from '@shared'
import { type Compiled, gen } from '../codegen-util'
import { Compile } from '../Compile'

type FunctionParameter = {
  index: number
  parameter: AST.ParameterDeclaration
}

/** FunctionalCoreCompiler compiles pure functions and render control flow. */
export const FunctionalCoreCompiler = {
  /** FunctionDeclaration compiles an expression-bodied Tao pure function. */
  FunctionDeclaration(fn: AST.FunctionDeclaration): Compiled {
    const parameters = AST.parametersOf(fn).map((parameter, index) => ({ index, parameter }))
    return gen`
      ${gen.scopeName(fn)} = TR.Function((${gen.join(parameters, Compile.FunctionRuntimeParameter)}) => {
        return TR.BlockScope(_Scope, _Scope => {
          ${gen.list(parameters, Compile.FunctionParameterBinding)}
          return ${Compile.Expression(fn.value)}
        })
      })
    `
  },

  /** FunctionRuntimeParameter emits one runtime-wrapped function parameter. */
  FunctionRuntimeParameter(parameter: FunctionParameter): Compiled {
    return gen`${functionRuntimeParameterName(parameter.index)}${
      parameter.parameter.defaultValue === undefined ? '' : '?'
    }: ${Compile.ParameterType(parameter.parameter)}`
  },

  /** FunctionParameterBinding exposes one positional argument through Tao lexical scope. */
  FunctionParameterBinding(parameter: FunctionParameter): Compiled {
    const name = { name: Type.parameterName(parameter.parameter) }
    const runtimeParameter = functionRuntimeParameterName(parameter.index)
    return parameter.parameter.defaultValue === undefined
      ? gen`${gen.scopeName(name)} = ${runtimeParameter}`
      : gen`${gen.scopeName(name)} = ${runtimeParameter} ?? ${Compile.Expression(parameter.parameter.defaultValue)}`
  },

  /** RenderFragmentStatement compiles one child render/control-flow fragment. */
  RenderFragmentStatement(statement: AST.Render | AST.WhenRenderStatement | AST.ForStatement): Compiled {
    return Switch.type(statement, {
      ForStatement: Compile.ForStatement,
      WhenRenderStatement: Compile.WhenRenderStatement,
      RenderStatement: Compile.Render,
      ViewRender: Compile.Render,
    })
  },

  /** WhenRenderStatement compiles total render branches lazily in source order. */
  WhenRenderStatement(statement: AST.WhenRenderStatement): Compiled {
    return gen`
      {TR.WhenRender([
        ${
      gen.list(
        statement.branches,
        branch =>
          gen`[() => ${Compile.Expression(branch.condition)}, () => TR.BlockScope(_Scope, _Scope => {
            ${Compile.RenderBlockBody(branch.block)}
          })],`,
      )
    }
      ], () => TR.BlockScope(_Scope, _Scope => {
        ${Compile.RenderBlockBody(statement.otherwise.block)}
      }))}
    `
  },

  /** ForStatement compiles repeated rendering with an iteration-local Tao value binding. */
  ForStatement(statement: AST.ForStatement): Compiled {
    return gen`
      {TR.ForEach(${Compile.Expression(statement.collection)}, ${functionRuntimeParameterName(0)} =>
        TR.BlockScope(_Scope, _Scope => {
          ${gen.scopeName(statement)} = ${functionRuntimeParameterName(0)}
          ${Compile.RenderBlockBody(statement.block)}
        })
      )}
    `
  },
} as const

function functionRuntimeParameterName(index: number): Compiled {
  return gen.Name({ name: `_TaoFunctionArg${index}` })
}
