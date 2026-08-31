import { type ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Switch } from '@shared'
import { type Compiled, gen, resolveRef } from '../codegen-util'
import { Compile } from '../Compile'
import { compileDeclarationIdentity } from './declaration-identity'

export const StateCompiler = {
  /** StateDeclaration compiles a view-local Tao state value. */
  StateDeclaration(state: AST.StateDeclaration): Compiled {
    if (state.persist) {
      const app = owningAppDeclaration(state)
      return gen`${gen.scopeName(state)} = TR.PersistedState(
        () => ${Compile.Expression(state.value)},
        ${compileDeclarationIdentity(app)},
        ${gen.jsLiteral(state.name)},
        ${compilePersistedType(Type.ofReference(state.type!))},
      )`
    }
    return gen`${gen.scopeName(state)} = TR.State(() => ${Compile.Expression(state.value)})`
  },

  /** SetStatement compiles Tao state mutation. */
  SetStatement(setStatement: AST.SetStatement): Compiled {
    const state = resolveRef(setStatement.target)
    const compileCompoundSet = (operator: AST.SetOperator) =>
      gen`
        TR.Set(
          ${gen.scopeName(state)},
          () => TR.CompoundSet(${gen.scopeName(state)}, ${gen.jsLiteral(operator)}, ${
        Compile.Expression(setStatement.value)
      }),
        )
      `
    return Switch(setStatement.operator, {
      '=': () => gen`TR.Set(${gen.scopeName(state)}, () => ${Compile.Expression(setStatement.value)})`,
      '+=': compileCompoundSet,
      '-=': compileCompoundSet,
      '*=': compileCompoundSet,
      '/=': compileCompoundSet,
    })
  },
} as const

function owningAppDeclaration(state: AST.StateDeclaration): AST.AppDeclaration {
  const block = state.$container
  if (!AST.isAppBlock(block) || !AST.isAppDeclaration(block.$container)) {
    throw new Error(`Persisted state '${state.name}' is not owned by an app.`)
  }
  return block.$container
}

function compilePersistedType(type: ASTUtils.TaoType): Compiled {
  if (type.kind === 'primitive') {
    if (['boolean', 'duration', 'none', 'number', 'text', 'time'].includes(type.primitive)) {
      return gen`{ kind: "primitive", name: ${gen.jsLiteral(type.primitive)} }`
    }
    throw new Error(`Persisted state cannot use runtime type '${Type.displayName(type)}'.`)
  }
  if (type.kind === 'list') {
    return gen`{ kind: "list"${type.element ? gen`, element: ${compilePersistedType(type.element)}` : gen``} }`
  }
  if (type.kind === 'item' && type.item) {
    return gen`{ kind: "item", properties: {
      ${
      gen.list(type.item.properties, property =>
        gen`
        ${gen.jsLiteral(property.name)}: { optional: ${property.optional}, type: ${
          compilePersistedType(Type.ofProperty(property))
        } },
      `)
    }
    } }`
  }
  if (type.kind === 'union') {
    return gen`{ kind: "union", members: [${gen.join(type.members, compilePersistedType)}] }`
  }
  throw new Error(`Persisted state cannot use runtime type '${Type.displayName(type)}'.`)
}
