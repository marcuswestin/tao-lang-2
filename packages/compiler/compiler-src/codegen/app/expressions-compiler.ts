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
      NumberLiteral: Compile.NumberLiteral,
      StringLiteral: Compile.StringLiteral,
      ListLiteral: Compile.ListLiteral,
      MemberAccessExpression: Compile.MemberAccessExpression,
      ParenthesizedExpression: Compile.ParenthesizedExpression,
      TypedConstructor: Compile.TypedConstructor,
      UnaryOperation: Compile.UnaryOperation,
      ValueReference: Compile.ValueReference,
      WhenExpression: Compile.WhenExpression,
    })
  },

  /** BooleanLiteral compiles a Tao boolean literal into a Tao boolean value. */
  BooleanLiteral(literal: AST.BooleanLiteral): Compiled {
    return gen`TR.Value(${literal.value === 'true'})`
  },

  /** BinaryExpression compiles a Tao binary operation through the runtime operator table. */
  BinaryExpression(binary: AST.BinaryExpression): Compiled {
    return gen`TR.Operator(${gen.jsLiteral(binary.operator)}, ${Compile.Expression(binary.left)}, ${
      Compile.Expression(binary.right)
    })`
  },

  /** UnaryOperation compiles a Tao unary operation through the runtime operator table. */
  UnaryOperation(unary: AST.UnaryOperation): Compiled {
    return gen`TR.UnaryOperator(${gen.jsLiteral(unary.operator)}, ${Compile.Expression(unary.operand)})`
  },

  /** ParenthesizedExpression compiles the grouped expression; grouping is source-level only. */
  ParenthesizedExpression(parenthesized: AST.ParenthesizedExpression): Compiled {
    return Compile.Expression(parenthesized.expression)
  },

  /** WhenExpression compiles branches into lazily evaluated runtime conditionals. */
  WhenExpression(when: AST.WhenExpression): Compiled {
    return gen`TR.When([${
      gen.join(
        when.branches,
        branch => gen`[() => ${Compile.Expression(branch.condition)}, () => ${Compile.Expression(branch.value)}]`,
      )
    }], () => ${Compile.Expression(when.otherwise)})`
  },

  /** StringLiteral compiles a Tao string literal, expanding `{...}` interpolation into a template. */
  StringLiteral(str: AST.StringLiteral): Compiled {
    if (!ASTUtils.hasInterpolation(str)) {
      return gen`TR.Value(${gen.jsLiteral(str.value)})`
    }
    const segments = ASTUtils.interpolationSegments(str).map(segment =>
      segment.kind === 'text'
        ? gen`${templateText(segment.text)}`
        : gen`\${TR.Interpolate(${Compile.InterpolationValue(str, segment)})}`
    )
    return gen`TR.Value(\`${gen.join(segments, segment => segment, { separator: '' })}\`)`
  },

  /** InterpolationValue compiles one interpolated name path into a runtime value expression. */
  InterpolationValue(
    str: AST.StringLiteral,
    segment: Extract<ASTUtils.InterpolationSegment, { kind: 'value' }>,
  ): Compiled {
    const resolved = ASTUtils.resolveInterpolation(str, segment)
    Assert.defined(resolved.declaration, 'validated interpolation resolves to a value declaration', {
      source: segment.source,
    })
    return segment.path.slice(1).reduce<Compiled>(
      (value, member) => gen`TR.Member(${value}, ${gen.jsLiteral(member)})`,
      Compile.ValueDeclarationReference(resolved.declaration),
    )
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
        pair => gen`${gen.nameLiteral(pair.expected)}: ${Compile.Expression(pair.property.value)}.jsValue,`,
      )
    }
    })`
  },

  /** MemberAccessExpression compiles a member path into chained runtime member reads. */
  MemberAccessExpression(reference: AST.MemberAccessExpression): Compiled {
    const target = resolveRef(reference.target)
    return reference.members.reduce<Compiled>(
      (value, member) => gen`TR.Member(${value}, ${gen.jsLiteral(member)})`,
      Compile.ValueDeclarationReference(target),
    )
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
      FieldDeclaration: field => Compile.FieldReference(field),
      LoopVariable: loopVariable => gen`${gen.scopeName(loopVariable)}.evaluate()`,
      QueryDeclaration: query => gen`${gen.scopeName(query)}`,
      ParameterDeclaration: parameter => gen`${gen.scopeName({ name: Type.parameterName(parameter) })}.evaluate()`,
      StateDeclaration: state => gen`${gen.scopeName(state)}.evaluate()`,
    })
  },
} as const

// Literal text is emitted inside a generated JavaScript template literal.
function templateText(text: string): string {
  return text.replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${')
}

function itemPropertyBindingPairs(
  item: AST.ItemLiteral,
  itemType: AST.ItemTypeExpression,
): ASTUtils.ItemPropertyBindingPair[] {
  const result = ASTUtils.resolveItemPropertyBindings(itemType.properties, item.properties)
  Assert(result.diagnostics.length === 0, 'validated item constructor has no binding diagnostics')
  return result.pairs
}
