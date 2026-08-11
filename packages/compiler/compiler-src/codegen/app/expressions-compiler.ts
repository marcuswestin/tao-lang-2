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
      BinaryExpression: Compile.BinaryExpression,
      BooleanLiteral: Compile.BooleanLiteral,
      WhenExpression: Compile.WhenExpression,
      FunctionCallExpression: Compile.FunctionCallExpression,
      InterpolationExpression: Compile.InterpolationExpression,
      NumberLiteral: Compile.NumberLiteral,
      NoneLiteral: Compile.NoneLiteral,
      StringLiteral: Compile.StringLiteral,
      ListLiteral: Compile.ListLiteral,
      MemberAccessExpression: Compile.MemberAccessExpression,
      TypedConstructor: Compile.TypedConstructor,
      UnaryExpression: Compile.UnaryExpression,
      ValueReference: Compile.ValueReference,
    })
  },

  /** BooleanLiteral compiles a Tao boolean literal into a Tao value. */
  BooleanLiteral(value: AST.BooleanLiteral): Compiled {
    return gen`TR.Value(${value.value === 'true' ? 'true' : 'false'})`
  },

  /** NoneLiteral compiles Tao absence to JavaScript null behind a Tao value. */
  NoneLiteral(): Compiled {
    return gen`TR.Value(null)`
  },

  /** BinaryExpression delegates Tao operator semantics to the runtime. */
  BinaryExpression(expression: AST.BinaryExpression): Compiled {
    return gen`TR.Binary(${Compile.Expression(expression.left)}, ${gen.jsLiteral(expression.operator)}, ${
      Compile.Expression(expression.right)
    })`
  },

  /** UnaryExpression delegates Tao unary semantics to the runtime. */
  UnaryExpression(expression: AST.UnaryExpression): Compiled {
    return gen`TR.Unary(${gen.jsLiteral(expression.operator)}, ${Compile.Expression(expression.operand)})`
  },

  /** WhenExpression evaluates value branches lazily in source order. */
  WhenExpression(expression: AST.WhenExpression): Compiled {
    return gen`TR.When([
      ${
      gen.list(
        expression.branches,
        branch => gen`[() => ${Compile.Expression(branch.condition)}, () => ${Compile.Expression(branch.value)}],`,
      )
    }
    ], () => ${Compile.Expression(expression.otherwise.value)})`
  },

  /** InterpolationExpression joins evaluated Tao values as text. */
  InterpolationExpression(expression: AST.InterpolationExpression): Compiled {
    return gen`TR.Interpolate([${gen.join(expression.parts, Compile.Expression)}])`
  },

  /** FunctionCallExpression invokes a Tao pure function with positional arguments. */
  FunctionCallExpression(expression: AST.FunctionCallExpression): Compiled {
    const fn = resolveRef(expression.function)
    return gen`TR.Call(${gen.scopeName(fn)}${
      gen.join(AST.argumentsOf(expression), argument => gen`, ${Compile.Argument(argument)}`, { separator: '' })
    })`
  },

  /** StringLiteral compiles a Tao string literal into a Tao text value. */
  StringLiteral(str: AST.StringLiteral): Compiled {
    return gen`TR.Value(${gen.jsLiteral(str.value)})`
  },

  /** NumberLiteral compiles a Tao number literal into a Tao number value. */
  NumberLiteral(num: AST.NumberLiteral): Compiled {
    return gen`TR.Value(${gen.jsLiteral(num.value)})`
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
        pair => gen`[${gen.nameLiteral(pair.expected)}]: ${Compile.Expression(pair.property.value)}.jsValue,`,
      )
    }
    })`
  },

  /** MemberAccessExpression compiles a typed item member path into a runtime value wrapper. */
  MemberAccessExpression(reference: AST.MemberAccessExpression): Compiled {
    const target = resolveRef(reference.target)
    const root = Compile.ValueDeclarationReference(target)
    return gen`TR.Member(${root}, [${gen.join(reference.members, member => gen`${gen.jsLiteral(member)}`)}])`
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
      ForStatement: statement => gen`${gen.scopeName(statement)}.evaluate()`,
      ParameterDeclaration: parameter => gen`${gen.scopeName({ name: Type.parameterName(parameter) })}.evaluate()`,
      QueryDeclaration: query => gen`${gen.scopeName(query)}.evaluate()`,
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
