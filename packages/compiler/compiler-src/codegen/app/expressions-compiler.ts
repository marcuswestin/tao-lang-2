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
      EmptyExpression: Compile.EmptyExpression,
      WhenExpression: Compile.WhenExpression,
      FunctionCallExpression: Compile.FunctionCallExpression,
      InterpolatedString: Compile.InterpolatedString,
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

  /** ConfiguredValue lowers the closed stdlib configuration constructors used by apps and navigation. */
  ConfiguredValue(value: AST.ConfiguredValue): Compiled {
    const type = resolveRef(value.type)
    const resolvedType = Type.ofConfiguredValue(value)
    if (resolvedType.kind === 'item' && type.name !== 'Local' && type.name !== 'Memory') {
      return compileConfiguredItem(value, resolvedType.item)
    }
    const entries = new Map(value.block.entries.map(entry => [entry.name, entry.value]))
    const initial = entries.get('Initial')
    if (type.name === 'StackNav') {
      Assert.defined(initial, 'validated StackNav configuration has Initial')
      return gen`TR.Navigation.StackNav({
        name: ${gen.jsLiteral(configuredValueName(value))},
        initial: ${Compile.ConfigurationValue(initial)},
      })`
    }
    if (type.name === 'SlotNav') {
      Assert.defined(initial, 'validated SlotNav configuration has Initial')
      return gen`TR.Navigation.SlotNav({
        name: ${gen.jsLiteral(configuredValueName(value))},
        initial: ${Compile.ConfigurationValue(initial)},
      })`
    }
    if (type.name === 'OverlayNav') {
      return gen`TR.Navigation.OverlayNav({ name: ${gen.jsLiteral(configuredValueName(value))} })`
    }
    if (type.name === 'Local') {
      const storageKey = entries.get('StorageKey')
      Assert.defined(storageKey, 'validated Local configuration has StorageKey')
      return gen`TR.Data.Source('local', ${Compile.ConfigurationValue(storageKey)})`
    }
    if (type.name === 'Memory') {
      return gen`TR.Data.Source('memory')`
    }
    return Assert.never(type.name as never, `validated configured type '${type.name}' is supported`)
  },

  /** ConfigurationValue compiles a scalar/reference slot or a nested configured value. */
  ConfigurationValue(value: AST.ConfigurationValue): Compiled {
    return AST.isConfiguredValue(value) ? Compile.ConfiguredValue(value) : Compile.Expression(value)
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

  /** EmptyExpression matches empty text/lists and ready queries with no rows. */
  EmptyExpression(expression: AST.EmptyExpression): Compiled {
    return gen`TR.IsEmpty(${Compile.Expression(expression.value)})`
  },

  /** WhenExpression evaluates one subject and selects one lazy value case. */
  WhenExpression(expression: AST.WhenExpression): Compiled {
    return gen`TR.WhenCase(${Compile.Expression(expression.subject)}, [
      ${
      gen.list(
        expression.branches,
        branch => gen`[${gen.jsLiteral(branch.case)}, () => ${Compile.Expression(branch.value)}],`,
      )
    }
    ], () => ${Compile.Expression(expression.otherwise.value)})`
  },

  /** InterpolatedString joins literal text and lazily evaluated scalar expressions. */
  InterpolatedString(expression: AST.InterpolatedString): Compiled {
    return gen`TR.Interpolate([${
      gen.join(expression.parts, part =>
        Switch.type(part, {
          InterpolatedStringText: text => gen`TR.Value(${gen.jsLiteral(text.value)})`,
          StringInterpolation: interpolation => Compile.Expression(interpolation.expression),
        }))
    }])`
  },

  /** FunctionCallExpression invokes a Tao pure function with owner-bound arguments. */
  FunctionCallExpression(expression: AST.FunctionCallExpression): Compiled {
    const resolved = ASTUtils.resolveFunctionInvocation(expression)
    const fn = resolved.function
    Assert.defined(fn, 'validated function call resolves its declaration')
    Assert(resolved.diagnostics.length === 0, 'validated function call has no binding diagnostics')
    const parameters = AST.parametersOf(fn)
    const argumentsByParameter = new Map(resolved.pairs.map(pair => [pair.parameter, pair.argument]))
    const lastProvidedIndex = Math.max(...resolved.pairs.map(pair => parameters.indexOf(pair.parameter)), -1)
    return gen`TR.Call(${gen.scopeName(fn)}${
      gen.join(
        parameters.slice(0, lastProvidedIndex + 1),
        parameter => {
          const argument = argumentsByParameter.get(parameter)
          return argument ? gen`, ${Compile.Argument(argument)}` : gen`, undefined`
        },
        { separator: '' },
      )
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
    if (AST.isEntityDataField(target)) {
      return gen`TR.Value(${reference.target.$refText === target.name ? 'true' : 'false'})`
    }
    return Compile.ValueDeclarationReference(target)
  },

  /** ValueDeclarationReference compiles an alias or parameter declaration reference. */
  ValueDeclarationReference(target: AST.ValueDeclaration): Compiled {
    return Switch.type(target, {
      ActionDeclaration: action => gen`${gen.scopeName(action)}.evaluate()`,
      AliasDeclaration: alias => gen`${gen.scopeName(alias)}.evaluate()`,
      CasePayload: payload => gen`${gen.scopeName(payload)}.evaluate()`,
      EntityDataField: () => gen`TR.Value(true)`,
      EntityQueryDeclaration: query => gen`${gen.scopeName(query)}.evaluate()`,
      ForStatement: statement => gen`${gen.scopeName(statement)}.evaluate()`,
      ParameterDeclaration: parameter => gen`${gen.scopeName({ name: Type.parameterName(parameter) })}.evaluate()`,
      StateDeclaration: state => gen`${gen.scopeName(state)}.evaluate()`,
      UiDeclaration: ui => Compile.UiValue(ui),
    })
  },

  /** UiValue creates a presentation descriptor without making `ui` embeddable as a child render. */
  UiValue(ui: AST.UiDeclaration): Compiled {
    return gen`TR.Navigation.UI({
      name: ${gen.jsLiteral(ui.name)},
      render: (_NavigationArguments, _NavigationProps) =>
        <${gen.scopeName(ui)}${
      gen.join(AST.parametersOf(ui), parameter => {
        const name = Type.parameterName(parameter)
        return gen` ${gen.Name({ name })}={_NavigationArguments[${gen.jsLiteral(name)}]}`
      }, { separator: '' })
    } __tao={_NavigationProps} />,
    })`
  },
} as const

function configuredValueName(value: AST.ConfiguredValue): string {
  const owner = value.$container
  if (AST.isAliasDeclaration(owner)) {
    return owner.name
  }
  if (AST.isAppNavigator(owner) || AST.isAppAuxiliaryNavigator(owner)) {
    const app = owner.$container.$container
    return AST.isAppDeclaration(app)
      ? `${app.name}${AST.isAppAuxiliaryNavigator(owner) ? owner.name : ''}`
      : value.type.$refText
  }
  return value.type.$refText
}

function itemPropertyBindingPairs(
  item: AST.ItemLiteral,
  itemType: AST.ItemTypeExpression,
): ASTUtils.ItemPropertyBindingPair[] {
  const result = ASTUtils.resolveItemPropertyBindings(itemType.properties, item.properties)
  Assert(result.diagnostics.length === 0, 'validated item constructor has no binding diagnostics')
  return result.pairs
}

function compileConfiguredItem(
  value: AST.ConfiguredValue,
  itemType: AST.ItemTypeExpression | undefined,
): Compiled {
  if (!itemType) {
    Assert(value.block.entries.length === 0, 'validated shapeless item constructor is empty')
    return gen`TR.Value({})`
  }
  const remaining = new Set(itemType.properties)
  const pairs = value.block.entries.map(entry => {
    const declaration = Type.visibleDeclaration(entry, entry.name)
    Assert.defined(declaration, 'validated configured item entry resolves its nominal type')
    const actual = Type.ofDefinition(declaration)
    const exact = [...remaining].filter(property =>
      Type.identityKey(Type.ofProperty(property)) === Type.identityKey(actual)
    )
    const assignable = exact.length === 1
      ? exact
      : [...remaining].filter(property => Type.isAssignable(actual, Type.ofProperty(property)))
    Assert(assignable.length === 1, 'validated configured item entry binds one field')
    const expected = assignable[0]!
    remaining.delete(expected)
    return { entry, expected }
  })
  Assert(remaining.size === 0, 'validated configured item constructor binds every field')
  return gen`TR.Value({
    ${
    gen.list(pairs, pair =>
      gen`[${gen.nameLiteral(pair.expected)}]: ${Compile.ConfigurationValue(pair.entry.value)}.jsValue,`)
  }
  })`
}
