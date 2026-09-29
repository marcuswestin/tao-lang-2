import { type ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Assert, Errors, Switch } from '@shared'
import { type Compiled, gen, resolveRef } from '../codegen-util'
import { Compile } from '../Compile'
import { compileDeclarationIdentity } from './declaration-identity'
import { compileWritableTarget } from './reactive-parameters'

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
    const target = compileWritableTarget(state, setStatement.members)
    const awaitKeyword = AST.isParameterDeclaration(state) ? gen`await ` : gen``
    const compileCompoundSet = (operator: AST.SetOperator) =>
      gen`
        ${awaitKeyword}TR.Set(
          ${target},
          () => TR.CompoundSet(${target}, ${gen.jsLiteral(operator)}, ${Compile.Expression(setStatement.value)}),
        )
      `
    return Switch(setStatement.operator, {
      '=': () => gen`${awaitKeyword}TR.Set(${target}, () => ${Compile.Expression(setStatement.value)})`,
      '+=': compileCompoundSet,
      '-=': compileCompoundSet,
      '*=': compileCompoundSet,
      '/=': compileCompoundSet,
    })
  },
} as const

function owningAppDeclaration(state: AST.StateDeclaration): AST.AppDeclaration {
  const block = state.$container
  Assert(
    AST.isAppBlock(block) && AST.isAppDeclaration(block.$container),
    `validated persisted state '${state.name}' is declared directly inside an app`,
  )
  return block.$container
}

function compilePersistedType(type: ASTUtils.TaoType): Compiled {
  return Switch.kind(type, {
    primitive: type => {
      if (['boolean', 'duration', 'none', 'number', 'text', 'time'].includes(type.primitive)) {
        return gen`{ kind: "primitive", name: ${gen.jsLiteral(type.primitive)} }`
      }
      unsupportedPersistedType(type)
    },
    list: type => gen`{ kind: "list"${type.element ? gen`, element: ${compilePersistedType(type.element)}` : gen``} }`,
    item: type =>
      type.item
        ? gen`{ kind: "item", properties: {
      ${
          gen.list(Type.itemFields(type.item), property =>
            gen`
        ${gen.jsLiteral(property.name)}: { optional: ${property.optional}, type: ${
              compilePersistedType(Type.itemFieldType(property))
            } },
      `)
        }
    } }`
        : unsupportedPersistedType(type),
    entity: type => unsupportedPersistedType(type),
    enum: type => {
      const identity = compileDeclarationIdentity(type.declaration)
      return gen`{ kind: "enum", declaration: ${identity}.canonical, cases: [${
        gen.join(
          AST.caseSetCasesOf(type.declaration),
          caseSetCase => gen`${gen.jsLiteral(AST.caseSetCaseName(caseSetCase))}`,
        )
      }] }`
    },
    union: type => gen`{ kind: "union", members: [${gen.join(type.members, compilePersistedType)}] }`,
    unresolved: type => unsupportedPersistedType(type),
  })
}

/**
 * `StateValidator` already rejects a nonpersistable persisted state, so codegen reaching this type
 * is a Tao bug rather than something the program's author can fix.
 */
function unsupportedPersistedType(type: ASTUtils.TaoType): never {
  Errors.throwUnexpected(
    `Expected: validated persisted state to use a persistable runtime type, not '${Type.displayName(type)}'`,
  )
}
