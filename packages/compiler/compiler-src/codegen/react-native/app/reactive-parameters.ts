import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { type Compiled, gen } from '../codegen-util'
import { Compile } from '../Compile'

/** Arguments retain their source storage or a live read, rather than sampling at the call site. */
export function compileReactiveArgument(expression: AST.Expression): Compiled {
  if (ASTUtils.writableExpression(expression)) {
    const target = AST.isValueReference(expression) || AST.isMemberAccessExpression(expression)
      ? expression.target.ref
      : undefined
    if (AST.isValueDeclaration(target)) {
      return compileWritableTarget(target, AST.isMemberAccessExpression(expression) ? expression.members : [])
    }
  }
  const type = Type.ofExpression(expression)
  if (type.kind === 'capability') {
    return gen`TR.Alias(() => ${Compile.Expression(expression)})`
  }
  // Presentable and callable values carry behavior on their evaluated wrapper, rather than
  // solely in jsValue. Preserve that wrapper while keeping the argument's read live.
  if (
    type.kind === 'primitive'
    && ['view', 'scene', 'nav', 'app', 'action', 'command', 'datasource', 'data', 'design'].includes(type.primitive)
  ) {
    return gen`TR.Alias(() => ${Compile.Expression(expression)})`
  }
  return gen`TR.Readonly(TR.Alias(() => ${Compile.Expression(expression)}))`
}

/** The validator admits only writable roots and ordinary item paths here. */
export function compileWritableTarget(target: AST.ValueDeclaration, members: readonly string[]): Compiled {
  const name = { name: Type.declarationName(target) }
  let value = gen`${gen.scopeName(name)}`
  for (const member of members) {
    value = gen`(TR.Member(${value}, ${gen.jsLiteral([member])}) as TR.Writable<any>)`
  }
  return value
}

export function nativeParameterName(parameter: AST.ParameterDeclaration): Compiled {
  return gen.Name({ name: `_TaoNative_${Type.parameterName(parameter)}` })
}

/** Native code receives a sampled read and a revocable action callback, never the writable cell. */
export function compileNativeParameter(parameter: AST.ParameterDeclaration): Compiled {
  const value = gen.scopeName({ name: Type.parameterName(parameter) })
  return gen`{ value: ${value}.evaluate().jsValue, change: (next: any) => ${
    nativeParameterName(parameter)
  }.set(TR.Value(next)) }`
}
