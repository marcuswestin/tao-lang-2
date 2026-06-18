import ASTUtils, { Type } from '@ast-utils'
import { AST } from '@parser'
import { Switch } from '@shared'
import { type Compiled, gen, genJoin, genList, genScopeName, resolveRef } from '../codegen-util'
import { Compile } from '../Compile'

export default {
  /** Expression compiles a Tao expression into a runtime value expression. */
  Expression(expression: AST.Expression): Compiled {
    return Switch.type(expression, {
      NumberLiteral: Compile.NumberLiteral,
      StringLiteral: Compile.StringLiteral,
      ListLiteral: Compile.ListLiteral,
      MemberAccessExpression: Compile.MemberAccessExpression,
      TypeCastExpression: Compile.TypeCastExpression,
      TypedConstructor: Compile.TypedConstructor,
      ValueReference: Compile.ValueReference,
    })
  },

  /** StringLiteral compiles a Tao string literal into a Tao text value. */
  StringLiteral(str: AST.StringLiteral): Compiled {
    return gen`new TR.Value(${JSON.stringify(str.value)})`
  },

  /** NumberLiteral compiles a Tao number literal into a Tao number value. */
  NumberLiteral(num: AST.NumberLiteral): Compiled {
    return gen`new TR.Value(${JSON.stringify(num.value)})`
  },

  /** ListLiteral compiles a Tao list literal into a runtime value wrapper. */
  ListLiteral(list: AST.ListLiteral): Compiled {
    return gen`new TR.Value([${genJoin(list.elements, element => gen`${Compile.Expression(element)}.jsValue`)}])`
  },

  /** TypeCastExpression compiles `as` away after validation. */
  TypeCastExpression(cast: AST.TypeCastExpression): Compiled {
    return Compile.Expression(cast.value)
  },

  /** TypedConstructor compiles the named type wrapper away after validation. */
  TypedConstructor(constructor: AST.TypedConstructor): Compiled {
    if (AST.isItemLiteral(constructor.value)) {
      return Compile.ItemLiteral(constructor.value, constructor.type)
    }
    return Compile.Expression(constructor.value)
  },

  /** ItemLiteral compiles an item constructor to a plain JavaScript object runtime value. */
  ItemLiteral(item: AST.ItemLiteral, type: AST.ConstructorTypeReference): Compiled {
    const itemType = Type.constructorReferenceItemType(type)
    const pairs = itemType ? ASTUtils.resolveItemPropertyBindings(itemType.properties, item.properties).pairs : []
    return gen`new TR.Value({
      ${
      genList(pairs, pair =>
        gen`${JSON.stringify(pair.expected.name)}: ${Compile.Expression(pair.property.value)}.jsValue,`)
    }
    })`
  },

  /** MemberAccessExpression compiles a typed item member path into a runtime value wrapper. */
  MemberAccessExpression(reference: AST.MemberAccessExpression): Compiled {
    const target = resolveRef(reference.target)
    const root = Compile.ValueDeclarationReference(target)
    const path = reference.members.map(member => `[${JSON.stringify(member)}]`).join('')
    return gen`new TR.Value(${root}.jsValue${path})`
  },

  /** ValueReference compiles an alias or parameter reference into a Tao value expression. */
  ValueReference(reference: AST.ValueReference): Compiled {
    const target = resolveRef(reference.target)
    return Compile.ValueDeclarationReference(target)
  },

  /** ValueDeclarationReference compiles an alias or parameter declaration reference. */
  ValueDeclarationReference(target: AST.ValueDeclaration): Compiled {
    return Switch.type(target, {
      AliasDeclaration: alias => gen`${genScopeName(alias)}.evaluate()`,
      ParameterDeclaration: parameter => gen`${genScopeName({ name: Type.parameterName(parameter) })}.evaluate()`,
    })
  },
} as const
