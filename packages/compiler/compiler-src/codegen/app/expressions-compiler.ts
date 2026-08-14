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
      CaseTestExpression: Compile.CaseTestExpression,
      ConfigurationConstructor: Compile.ConfiguredValue,
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

  /** ConfiguredValue lowers constructors through their linked Tao declaration identity. */
  ConfiguredValue(value: AST.ConfiguredValue): Compiled {
    const declaration = resolveRef(value.type)
    const resolvedType = Type.ofConfiguredValue(value)
    if (AST.isTypeDeclaration(declaration) || AST.isParameterizedDeclaration(declaration)) {
      if (value.value) {
        return Compile.Expression(value.value)
      }
      if (resolvedType.kind !== 'item') {
        return Assert.never(resolvedType as never, 'validated named block constructor resolves an item type')
      }
      return compileConfiguredItem(value, resolvedType.item)
    }
    Assert.defined(value.block, 'validated configurable declaration constructor has a block')
    const config = compileConfigurationObject(value.block)
    return AST.isNavDeclaration(declaration)
      ? gen`TR.Navigation.Configure(${gen.scopeName(declaration)}, ${config})`
      : gen`TR.Data.Configure(${gen.scopeName(declaration)}, ${config})`
  },

  /** ConfigurationValue compiles a scalar/reference slot or a nested configured value. */
  ConfigurationValue(value: AST.ConfigurationValue): Compiled {
    if (AST.isConfiguredValue(value)) {
      return Compile.ConfiguredValue(value)
    }
    if (AST.isConfigurationReference(value)) {
      return compileConfigurationReference(value)
    }
    if (AST.isConfigurationKeyValue(value)) {
      return gen`TR.Value(${gen.jsLiteral(value.key)})`
    }
    if (AST.isPropertyConfigurationPatch(value)) {
      return Assert.never(value as never, 'property-position with is compiled against its owning property')
    }
    return Compile.Expression(value)
  },

  /** ConfigurationPatchObject lowers property replacements and keyed additions without mutating the base. */
  ConfigurationPatchObject(block: AST.ConfigurationBlock): Compiled {
    return compileConfigurationPatchObject(block)
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

  /** CaseTestExpression compares one subject with a built-in or declaration-linked case. */
  CaseTestExpression(expression: AST.CaseTestExpression): Compiled {
    if (expression.builtinCase) {
      return gen`TR.IsCase(${Compile.Expression(expression.value)}, ${gen.jsLiteral(expression.builtinCase)})`
    }
    Assert.defined(expression.declaredCase, 'parsed case test has a declared or built-in case')
    const declaredCase = resolveRef(expression.declaredCase)
    if (AST.isEntityDataField(declaredCase)) {
      return gen`TR.IsCase(${Compile.Expression(expression.value)}, TR.Value(${
        expression.declaredCase.$refText === declaredCase.name ? 'true' : 'false'
      }))`
    }
    return gen`TR.IsCase(${Compile.Expression(expression.value)}, ${Compile.ValueDeclarationReference(declaredCase)})`
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
  ItemLiteral(item: AST.ItemLiteral, type: AST.ConstructablePrimitiveTypeReference | AST.TypeReference): Compiled {
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
    if (AST.isPatchedValueReference(reference)) {
      return compileConfiguredPatch(reference)
    }
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
      AppDeclaration: app => gen`${gen.Name({ name: `_TaoAppDefinition_${app.name}` })}`,
      AskStatement: ask => gen`${gen.scopeName(ask)}.evaluate()`,
      CasePayload: payload => gen`${gen.scopeName(payload)}.evaluate()`,
      EntityDataField: () => gen`TR.Value(true)`,
      EntityQueryDeclaration: query => gen`${gen.scopeName(query)}.evaluate()`,
      EnumCase: enumCase => gen`${gen.scopeName(AST.enumOwningCase(enumCase))}.${gen.Name(enumCase)}`,
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

  /** DialogueValue creates the independently askable descriptor for one dialogue declaration. */
  DialogueValue(dialogue: AST.DialogueDeclaration): Compiled {
    return gen`TR.Navigation.Dialogue({
      name: ${gen.jsLiteral(dialogue.name)},
      render: (_NavigationArguments, _NavigationProps) =>
        <${gen.scopeName(dialogue)}${
      gen.join(AST.parametersOf(dialogue), parameter => {
        const name = Type.parameterName(parameter)
        return gen` ${gen.Name({ name })}={_NavigationArguments[${gen.jsLiteral(name)}]}`
      }, { separator: '' })
    } __tao={_NavigationProps} />,
    })`
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

function compileConfiguredItem(
  value: AST.ConfigurationConstructor,
  itemType: AST.ItemTypeExpression | undefined,
): Compiled {
  Assert.defined(value.block, 'validated item constructor has a block')
  if (!itemType) {
    Assert(value.block.entries.length === 0, 'validated shapeless item constructor is empty')
    return gen`TR.Value({})`
  }
  const remaining = new Set(itemType.properties)
  const pairs: Array<{ expected: AST.TypeProperty; compiled: Compiled }> = []
  for (const entry of value.block.entries) {
    if (entry.label && entry.expression) {
      const expected: AST.TypeProperty | undefined = itemType.properties.find(
        (property: AST.TypeProperty) => property.name === entry.label,
      )
      Assert.defined(expected, 'validated configured item label resolves one field')
      remaining.delete(expected)
      pairs.push({ expected, compiled: Compile.Expression(entry.expression) })
      continue
    }
    const candidate = compileConfiguredItemEntry(entry)
    Assert.defined(candidate, 'validated configured item entry has a constructable value')
    const actual = candidate.type
    const exact = [...remaining].filter(property =>
      Type.identityKey(Type.ofProperty(property)) === Type.identityKey(actual)
    )
    const assignable = exact.length === 1
      ? exact
      : [...remaining].filter(property => Type.isAssignable(actual, Type.ofProperty(property)))
    Assert(assignable.length === 1, 'validated configured item entry binds one field')
    const expected = assignable[0]!
    remaining.delete(expected)
    pairs.push({ expected, compiled: candidate.compiled })
  }
  Assert(remaining.size === 0, 'validated configured item constructor binds every field')
  pairs.sort((left, right) => itemType.properties.indexOf(left.expected) - itemType.properties.indexOf(right.expected))
  return gen`TR.Value({
    ${gen.list(pairs, pair => gen`[${gen.nameLiteral(pair.expected)}]: ${pair.compiled}.jsValue,`)}
  })`
}

function compileConfiguredItemEntry(
  entry: AST.ConfigurationEntry,
): { compiled: Compiled; type: ASTUtils.TaoType } | undefined {
  if (entry.expression) {
    return { compiled: Compile.Expression(entry.expression), type: Type.ofExpression(entry.expression) }
  }
  if (entry.reference?.ref) {
    const declaration = resolveRef(entry.reference)
    return {
      compiled: Compile.ValueDeclarationReference(declaration),
      type: Type.ofValueDeclaration(declaration),
    }
  }
  if (entry.name && (entry.block || entry.value)) {
    const declaration = Type.visibleDeclaration(entry, entry.name)
    if (!declaration) {
      return undefined
    }
    const constructor = {
      $type: 'ConfigurationConstructor',
      type: { $refText: entry.name, ref: declaration },
      members: entry.nameMembers ?? [],
      ...(entry.block ? { block: entry.block } : { value: entry.value }),
      $container: entry,
    } as unknown as AST.ConfigurationConstructor
    return { compiled: Compile.ConfiguredValue(constructor), type: Type.ofConfiguredValue(constructor) }
  }
  return undefined
}

function compileConfigurationReference(value: AST.ConfigurationReference): Compiled {
  const target = resolveRef(value.target)
  if (AST.isConfigurableDeclaration(target)) {
    return AST.isNavDeclaration(target)
      ? gen`TR.Navigation.Configure(${gen.scopeName(target)}, {})`
      : gen`TR.Data.Configure(${gen.scopeName(target)}, {})`
  }
  if (AST.isUiDeclaration(target)) {
    return Compile.UiValue(target)
  }
  if (AST.isAliasDeclaration(target)) {
    return Compile.ValueDeclarationReference(target)
  }
  return Assert.never(target as never, 'validated configuration reference targets a configurable declaration')
}

function compileConfigurationObject(block: AST.ConfigurationBlock): Compiled {
  return gen`{
    ${
    gen.list(block.entries, entry => {
      if (entry.key && entry.block) {
        return gen`${gen.jsLiteral(entry.key)}: ${compileConfigurationObject(entry.block)},`
      }
      Assert.defined(entry.name, 'validated configuration entry has a property name')
      Assert.defined(entry.value, 'validated configuration property has a value')
      Assert(!AST.isPropertyConfigurationPatch(entry.value), 'configuration property patch is compiled by its owner')
      return gen`${gen.jsLiteral(entry.name)}: ${Compile.ConfigurationValue(entry.value)},`
    })
  }
  }`
}

function compileConfiguredPatch(value: AST.PatchedValueReference): Compiled {
  const base = resolveRef(value.target)
  Assert.is(base, AST.isAliasDeclaration, 'generic configured patches currently target configured value aliases')
  const patch = compileConfigurationPatchObject(value.patchBlock)
  const type = Type.ofValueDeclaration(base)
  if (type.kind === 'primitive' && type.primitive === 'nav') {
    return gen`TR.Navigation.Patch(${Compile.ValueDeclarationReference(base)}, ${patch})`
  }
  if (type.kind === 'item') {
    return gen`TR.Data.Patch(${Compile.ValueDeclarationReference(base)}, ${patch})`
  }
  return Assert.never(type as never, 'validated configured patch targets nav, datasource, or app')
}

function compileConfigurationPatchObject(block: AST.ConfigurationBlock): Compiled {
  return gen`{
    ${
    gen.list(block.entries, entry => {
      if (entry.key && entry.block) {
        return gen`${gen.jsLiteral(entry.key)}: ${compileConfigurationObject(entry.block)},`
      }
      Assert.defined(entry.name, 'validated patch entry has a property name')
      Assert.defined(entry.value, 'validated patch entry has a property value')
      return gen`${gen.jsLiteral(entry.name)}: ${Compile.ConfigurationValue(entry.value)},`
    })
  }
  }`
}
