import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Assert, Switch } from '@shared'
import { type Compiled, gen, resolveRef } from '../codegen-util'
import { Compile } from '../Compile'

export const ExpressionsCompiler = {
  /** Expression compiles a Tao expression into a runtime value expression. */
  Expression(expression: AST.Expression): Compiled {
    return Switch.type(expression, {
      ActionExpression: Compile.ActionExpression,
      NumberLiteral: Compile.NumberLiteral,
      StringLiteral: Compile.StringLiteral,
      ListLiteral: Compile.ListLiteral,
      MemberAccessExpression: Compile.MemberAccessExpression,
      TypedConstructor: Compile.TypedConstructor,
      ValueReference: Compile.ValueReference,
    })
  },

  /** StringLiteral compiles a Tao string literal into a Tao text value. */
  StringLiteral(str: AST.StringLiteral): Compiled {
    return gen`TR.Value(${JSON.stringify(str.value)})`
  },

  /** NumberLiteral compiles a Tao number literal into a Tao number value. */
  NumberLiteral(num: AST.NumberLiteral): Compiled {
    return gen`TR.Value(${JSON.stringify(num.value)})`
  },

  /** ListLiteral compiles a Tao list literal into a runtime value wrapper. */
  ListLiteral(list: AST.ListLiteral): Compiled {
    return gen`TR.Value([${gen.join(list.elements, element => gen`${Compile.Expression(element)}.jsValue`)}])`
  },

  /** TypedConstructor compiles the named type wrapper away after validation. */
  TypedConstructor(constructor: AST.TypedConstructor): Compiled {
    if (AST.isItemLiteral(constructor.value)) {
      return Compile.ItemLiteral(constructor.value, constructor.type)
    }
    return Compile.Expression(constructor.value)
  },

  /** ItemLiteral compiles an item constructor to a plain JavaScript object runtime value. */
  ItemLiteral(item: AST.ItemLiteral, type: AST.ConstructorTypeReference | AST.TypeReference): Compiled {
    const itemType = Type.constructorReferenceItemType(type)
    if (!itemType) {
      Assert(item.properties.length === 0, 'validated shapeless item constructor is empty')
      return gen`TR.Value({})`
    }
    const pairs = itemPropertyBindingPairs(item, itemType)
    return gen`TR.Value({
      ${
      gen.list(
        pairs,
        pair => gen`${gen.nameLiteral(pair.expected)}: ${Compile.Expression(pair.property.value)}.jsValue,`,
      )
    }
    })`
  },

  /** MemberAccessExpression compiles a typed item member path into a runtime value wrapper. */
  MemberAccessExpression(reference: AST.MemberAccessExpression): Compiled {
    const target = resolveRef(reference.target)
    const root = Compile.ValueDeclarationReference(target)
    const path = reference.members.map(member => `[${JSON.stringify(member)}]`).join('')
    return gen`TR.Value(${root}.jsValue${path})`
  },

  /** ValueReference compiles an alias or parameter reference into a Tao value expression. */
  ValueReference(reference: AST.ValueReference): Compiled {
    const target = resolveRef(reference.target)
    return Compile.ValueDeclarationReference(target)
  },

  /** ValueDeclarationReference compiles an alias or parameter declaration reference. */
  ValueDeclarationReference(target: AST.ValueDeclaration): Compiled {
    return Switch.type(target, {
      ActionDeclaration: action => gen`${gen.scopeName(action)}.evaluate()`,
      AliasDeclaration: alias => gen`${gen.scopeName(alias)}.evaluate()`,
      ParameterDeclaration: parameter => gen`${gen.scopeName({ name: Type.parameterName(parameter) })}.evaluate()`,
      StateDeclaration: state => gen`${gen.scopeName(state)}.evaluate()`,
    })
  },
} as const

function itemPropertyBindingPairs(
  item: AST.ItemLiteral,
  itemType: AST.ItemTypeExpression,
): ASTUtils.ItemPropertyBindingPair[] {
  const result = ASTUtils.resolveItemPropertyBindings(itemType.properties, item.properties)
  Assert(result.diagnostics.length === 0, 'validated item constructor has no binding diagnostics')
  return result.pairs
}
