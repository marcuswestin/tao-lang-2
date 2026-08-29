import { ASTUtils, Type, Units } from '@ast-utils'
import { AST } from '@parser'
import { Assert, Switch } from '@shared'
import { type Compiled, gen, resolveRef } from '../codegen-util'
import { Compile } from '../Compile'
import { configurationRuntimeBindingName } from './configuration-compiler'
import { bridgeBindingName } from './injection-plan'

const shapelessItemConstructorMessage = 'validated shapeless item constructor is empty'

export const ExpressionsCompiler = {
  /** Expression compiles a Tao expression into a runtime value expression. */
  Expression(expression: AST.Expression): Compiled {
    return Switch.type(expression, {
      ActionExpression: Compile.ActionExpression,
      BinaryExpression: Compile.BinaryExpression,
      NowExpression: () => gen`TR.Value(TR.now())`,
      FromExpression: Compile.FromExpression,
      PostfixMemberAccess: Compile.PostfixMemberAccess,
      BooleanLiteral: Compile.BooleanLiteral,
      CaseTestExpression: Compile.CaseTestExpression,
      ConfigurationConstructor: Compile.ConfiguredValue,
      WhenExpression: Compile.WhenExpression,
      FunctionCallExpression: Compile.FunctionCallExpression,
      InterpolatedString: Compile.InterpolatedString,
      InferredConfigurationConstructor: Compile.InferredConfiguration,
      NumberLiteral: Compile.NumberLiteral,
      NoneLiteral: Compile.NoneLiteral,
      PrimitiveConfigurationConstructor: Compile.PrimitiveConfigurationConstructor,
      RefinementExpression: Compile.RefinementExpression,
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
    if (AST.isConfigurableDeclaration(declaration)) {
      Assert.defined(value.block, 'validated configurable type constructor has a block')
      const config = compileConfiguredTypeObject(declaration, value.block)
      // The validator does not yet reject constructors of other configurable primitives (such as
      // app) in expression position; those keep their historical data-configuration lowering.
      return configureCall(declaration, config) ?? dataConfigureCall(declaration, config)
    }
    if (AST.isTypeDeclaration(declaration) || AST.isParameterizedDeclaration(declaration)) {
      if (value.value) {
        return Compile.Expression(value.value)
      }
      if (resolvedType.kind !== 'item') {
        return Assert.never(resolvedType as never, 'validated named block constructor resolves an item type')
      }
      return compileConfiguredItem(value, resolvedType.item)
    }
    return Assert.never(declaration as never, 'validated constructor declaration has a lowering')
  },

  /** PrimitiveConfigurationConstructor lowers direct primitive values after slot validation. */
  PrimitiveConfigurationConstructor(value: AST.PrimitiveConfigurationConstructor): Compiled {
    return gen`TR.Value(${compileConfigurationObject(value.block)})`
  },

  /** RefinementExpression constructs from a type or immutably derives from a value. */
  RefinementExpression(value: AST.RefinementExpression): Compiled {
    const base = resolveRef(value.target)
    if (AST.isTypeDeclaration(base)) {
      const constructor = {
        $type: 'ConfigurationConstructor',
        type: value.target,
        members: [],
        block: value.patchBlock,
        $container: value.$container,
      } as unknown as AST.ConfigurationConstructor
      return Compile.ConfiguredValue(constructor)
    }
    Assert.is(base, AST.isValueDeclaration, 'validated value refinement resolves a value declaration')
    return compileConfiguredPatch(value)
  },

  /** InferredConfiguration lowers a bare block through its same-name declaration type. */
  InferredConfiguration(value: AST.InferredConfigurationConstructor): Compiled {
    const declaration = inferredConfigurationDeclaration(value)
    if (declaration) {
      const call = configureCall(declaration, compileConfiguredTypeObject(declaration, value.block))
      Assert.defined(call, 'app inference is compiled by the owning app value')
      return call
    }
    const resolvedType = Type.ofInferredConfiguration(value)
    if (resolvedType.kind !== 'item') {
      return Assert.never(resolvedType as never, 'validated inferred configuration resolves an item type')
    }
    return compileConfiguredItemBlock(value.block, resolvedType.item)
  },

  /** ConfigurationValue compiles a scalar/reference slot or a nested configured value. */
  ConfigurationValue(value: AST.ConfigurationValue): Compiled {
    return Switch.type(value, {
      BooleanLiteral: Compile.Expression,
      ConfigurationConstructor: Compile.ConfiguredValue,
      ConfigurationKeyValue: value => gen`TR.Value(${gen.jsLiteral(value.key)})`,
      ConfigurationReference: compileConfigurationReference,
      NumberLiteral: Compile.Expression,
      PropertyConfigurationPatch: value =>
        Assert.never(value as never, 'property-position with is compiled against its owning property'),
      StringLiteral: Compile.Expression,
    })
  },

  /** ConfigurationPatchObject lowers property replacements and keyed additions without mutating the base. */
  ConfigurationPatchObject(
    block: AST.ConfigurationBlock,
    declaration?: AST.ConfigurableDeclaration,
  ): Compiled {
    return compileConfigurationPatchObject(block, declaration)
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
    const calendar = compileCalendarArithmetic(expression)
    if (calendar) {
      return calendar
    }
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
    // The compact form is the two-outcome sibling of the block form, so it lowers to the same case
    // switch: the positive case is `true`, and an omitted negative outcome is absence.
    if (expression.positive) {
      const negative = expression.negative
      return gen`TR.WhenCase(${Compile.Expression(expression.subject)}, [
        ['true', () => ${Compile.Expression(expression.positive)}],
      ], () => ${negative ? Compile.Expression(negative) : gen`TR.Value(null)`})`
    }
    Assert.defined(expression.otherwise, 'validated block-form when has an otherwise branch')
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
      Assert(item.properties.length === 0, shapelessItemConstructorMessage)
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
    return compileMemberPath(root, Type.ofValueDeclaration(target), reference.members)
  },

  /**
   * FromExpression calls the sidecar's named export with plain JavaScript arguments and wraps the
   * result as a Tao value, which is the whole bridge (Decisions §15).
   */
  FromExpression(bridge: AST.FromExpression): Compiled {
    const call = bridge.expression
    const values = AST.isFunctionCallExpression(call)
      ? (call.argumentList?.arguments ?? []).map(argument => gen`${Compile.Expression(argument.value)}.jsValue`)
      : undefined
    const binding = gen.Name({ name: bridgeBindingName(bridge) })
    return values
      ? gen`TR.Value(${binding}(${gen.join(values, value => value)}))`
      : gen`TR.Value(${binding})`
  },

  /** PostfixMemberAccess compiles a member read on any expression, including unit accessors. */
  PostfixMemberAccess(access: AST.PostfixMemberAccess): Compiled {
    return compileMemberPath(
      Compile.Expression(access.receiver),
      Type.ofExpression(access.receiver),
      [access.member],
    )
  },

  /** ValueReference compiles an alias or parameter reference into a Tao value expression. */
  ValueReference(reference: AST.ValueReference): Compiled {
    if (AST.isRefinementExpression(reference)) {
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
      DesignDeclaration: design => gen`${gen.scopeName(design)}.evaluate()`,
      EntityDataField: () => gen`TR.Value(true)`,
      EntityQueryDeclaration: query => gen`${gen.scopeName(query)}.evaluate()`,
      CaseSetCase: caseSetCase =>
        gen`${gen.scopeName(AST.caseSetOwningCase(caseSetCase))}.${
          gen.Name({ name: AST.caseSetCaseName(caseSetCase) })
        }`,
      ForStatement: statement => gen`${gen.scopeName(statement)}.evaluate()`,
      DatasourceDeclaration: declaration => gen`${gen.scopeName(declaration)}.evaluate()`,
      NavDeclaration: declaration => gen`${gen.scopeName(declaration)}.evaluate()`,
      ParameterDeclaration: parameter => gen`${gen.scopeName({ name: Type.parameterName(parameter) })}.evaluate()`,
      StateDeclaration: state => gen`${gen.scopeName(state)}.evaluate()`,
      UiDeclaration: ui => Compile.UiValue(ui),
    })
  },

  /** UiValue creates a presentation descriptor without making `ui` embeddable as a child render. */
  UiValue(ui: AST.UiDeclaration): Compiled {
    return compileNavigationDescriptor('UI', ui)
  },

  /** DialogueValue creates the independently askable descriptor for one dialogue declaration. */
  DialogueValue(dialogue: AST.DialogueDeclaration): Compiled {
    return compileNavigationDescriptor('Dialogue', dialogue)
  },
} as const

function compileNavigationDescriptor(
  kind: 'UI' | 'Dialogue',
  declaration: AST.UiDeclaration | AST.DialogueDeclaration,
): Compiled {
  return gen`TR.Navigation.${kind}({
      name: ${gen.jsLiteral(declaration.name)},
      render: (_NavigationArguments, _NavigationProps) =>
        <${gen.scopeName(declaration)}${
    gen.join(AST.parametersOf(declaration), parameter => {
      const name = Type.parameterName(parameter)
      return gen` ${name}={_NavigationArguments[${gen.jsLiteral(name)}]}`
    }, { separator: '' })
  } __tao={_NavigationProps} />,
    })`
}

function itemPropertyBindingPairs(
  item: AST.ItemLiteral,
  itemType: ASTUtils.ItemShape,
): ASTUtils.ItemPropertyBindingPair[] {
  const result = ASTUtils.resolveItemPropertyBindings(itemType.properties, item.properties)
  Assert(result.diagnostics.length === 0, 'validated item constructor has no binding diagnostics')
  return result.pairs
}

function compileConfiguredItem(
  value: AST.ConfigurationConstructor,
  itemType: ASTUtils.ItemShape | undefined,
): Compiled {
  Assert.defined(value.block, 'validated item constructor has a block')
  return compileConfiguredItemBlock(value.block, itemType)
}

function compileConfiguredItemBlock(
  block: AST.ConfigurationBlock,
  itemType: ASTUtils.ItemShape | undefined,
): Compiled {
  if (!itemType) {
    Assert(block.entries.length === 0, shapelessItemConstructorMessage)
    return gen`TR.Value({})`
  }
  const remaining = new Set(itemType.properties.filter(property => !Type.propertyIsFilled(property)))
  const pairs: Array<{ expected: AST.TypeProperty; compiled: Compiled }> = itemType.properties
    .filter(Type.propertyIsFilled)
    .map(expected => {
      Assert.defined(expected.value, 'filled item slot has a value')
      return { expected, compiled: Compile.Expression(expected.value) }
    })
  for (const entry of block.entries) {
    if (entry.label && entry.expression) {
      const expected: AST.TypeProperty | undefined = itemType.properties.find(
        (property: AST.TypeProperty) => property.name === entry.label,
      )
      Assert.defined(expected, 'validated configured item label resolves one field')
      remaining.delete(expected)
      pairs.push({ expected, compiled: Compile.Expression(entry.expression) })
      continue
    }
    const candidate = compileConfiguredItemEntry(entry, itemType)
    Assert.defined(candidate, 'validated configured item entry has a constructable value')
    const expected = bindSingleSlot(remaining, candidate.type, 'validated configured item entry binds one field')
    remaining.delete(expected)
    pairs.push({ expected, compiled: candidate.compiled })
  }
  for (const expected of [...remaining]) {
    if (!Type.propertyHasDefault(expected)) {
      continue
    }
    Assert.defined(expected.value, 'defaulted item slot has a value')
    pairs.push({ expected, compiled: Compile.Expression(expected.value) })
    remaining.delete(expected)
  }
  Assert(
    [...remaining].every(property => !Type.propertyRequiresValue(property)),
    'validated configured item constructor binds every required field',
  )
  pairs.sort((left, right) => itemType.properties.indexOf(left.expected) - itemType.properties.indexOf(right.expected))
  return gen`TR.Value({
    ${gen.list(pairs, pair => gen`[${gen.nameLiteral(pair.expected)}]: ${pair.compiled}.jsValue,`)}
  })`
}

function compileConfiguredItemEntry(
  entry: AST.ConfigurationEntry,
  itemType: ASTUtils.ItemShape,
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
  if (entry.name && entry.value) {
    const ownerProperty = itemType.properties.find(property => property.name === entry.name)
    if (ownerProperty) {
      return {
        compiled: Compile.ConfigurationValue(entry.value),
        type: Type.ofProperty(ownerProperty),
      }
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

/** configureCall binds a nav or datasource contract's runtime declaration to one compiled configuration.
 * App contracts have no runtime binding; they return undefined for the caller's own fallback. */
function configureCall(declaration: AST.ConfigurableDeclaration, config: Compiled): Compiled | undefined {
  const primitive = AST.configurationPrimitiveOf(declaration)
  if (primitive === 'nav') {
    const runtimeDeclaration = gen.scopeName({ name: configurationRuntimeBindingName(declaration) })
    return gen`TR.Navigation.Configure(${runtimeDeclaration}, ${config})`
  }
  return primitive === 'datasource' ? dataConfigureCall(declaration, config) : undefined
}

function dataConfigureCall(declaration: AST.ConfigurableDeclaration, config: Compiled): Compiled {
  const runtimeDeclaration = gen.scopeName({ name: configurationRuntimeBindingName(declaration) })
  return gen`TR.Data.Configure(${runtimeDeclaration}, ${config})`
}

/** bindSingleSlot picks the one unfilled slot an entry binds: an exact identity match wins, else assignability. */
function bindSingleSlot(
  remaining: ReadonlySet<AST.TypeProperty>,
  actual: ASTUtils.TaoType,
  message: string,
): AST.TypeProperty {
  const exact = [...remaining].filter(property =>
    Type.identityKey(Type.ofProperty(property)) === Type.identityKey(actual)
  )
  const assignable = exact.length === 1
    ? exact
    : [...remaining].filter(property => Type.isAssignable(actual, Type.ofProperty(property)))
  Assert(assignable.length === 1, message)
  return assignable[0]!
}

function compileConfigurationReference(value: AST.ConfigurationReference): Compiled {
  const target = resolveRef(value.target)
  if (AST.isConfigurableDeclaration(target)) {
    return configureCall(target, gen`{}`) ?? gen`TR.Value({})`
  }
  if (AST.isUiDeclaration(target)) {
    return Compile.UiValue(target)
  }
  if (
    AST.isAliasDeclaration(target)
    || AST.isNavDeclaration(target)
    || AST.isDatasourceDeclaration(target)
  ) {
    return Compile.ValueDeclarationReference(target)
  }
  return Assert.never(target as never, 'validated configuration reference targets a configurable declaration')
}

function compileConfigurationObject(block: AST.ConfigurationBlock): Compiled {
  return compileConfigurationObjectWithDefaults(block, [])
}

/** compileConfigurationObjectWithDefaults renders a block whose keyed items, not the block itself, fill the key defaults. */
function compileConfigurationObjectWithDefaults(
  block: AST.ConfigurationBlock,
  keyedDefaults: readonly AST.ConfigurationProperty[],
): Compiled {
  return gen`{
    ${compileConfigurationEntries(block, keyedDefaults)}
  }`
}

/** compileKeyedItemObject renders one keyed item and fills every key default it does not supply. */
function compileKeyedItemObject(
  block: AST.ConfigurationBlock,
  keyedDefaults: readonly AST.ConfigurationProperty[],
): Compiled {
  return gen`{
    ${compileConfigurationEntries(block, keyedDefaults)}
    ${
    gen.list(
      keyedDefaults.filter(property =>
        property.value !== undefined && !block.entries.some(entry => entry.name === property.name)
      ),
      property => {
        Assert.defined(property.value, 'defaulted configuration property has a value')
        return gen`${gen.jsLiteral(property.name)}: ${Compile.Expression(property.value)},`
      },
    )
  }
  }`
}

function compileConfigurationEntries(
  block: AST.ConfigurationBlock,
  keyedDefaults: readonly AST.ConfigurationProperty[],
): Compiled {
  return gen.list(block.entries, entry => {
    if (entry.key && entry.block) {
      return gen`${gen.jsLiteral(entry.key)}: ${compileKeyedItemObject(entry.block, keyedDefaults)},`
    }
    Assert.defined(entry.name, 'validated configuration entry has a property name')
    Assert.defined(entry.value, 'validated configuration property has a value')
    Assert(!AST.isPropertyConfigurationPatch(entry.value), 'configuration property patch is compiled by its owner')
    return gen`${gen.jsLiteral(entry.name)}: ${Compile.ConfigurationValue(entry.value)},`
  })
}

function compileConfiguredPatch(value: AST.RefinementExpression): Compiled {
  const base = resolveRef(value.target)
  Assert.is(base, AST.isValueDeclaration, 'validated refinement target is a value')
  const patch = compileConfigurationPatchObject(value.patchBlock, configuredDeclarationOfValue(base))
  const type = Type.ofValueDeclaration(base)
  if (type.kind === 'primitive' && type.primitive === 'nav') {
    return gen`TR.Navigation.Patch(${Compile.ValueDeclarationReference(base)}, ${patch})`
  }
  if (type.kind === 'primitive' && type.primitive === 'datasource') {
    return gen`TR.Data.Patch(${Compile.ValueDeclarationReference(base)}, ${patch})`
  }
  if (type.kind === 'item') {
    if (type.item) {
      Assert.is(base, AST.isAliasDeclaration, 'item refinements target immutable let values')
      return compileItemPatch(value, base, type.item)
    }
    return gen`TR.Data.Patch(${Compile.ValueDeclarationReference(base)}, ${patch})`
  }
  return Assert.never(type as never, 'validated configured patch targets nav, datasource, or app')
}

function compileConfiguredTypeObject(
  declaration: AST.ConfigurableDeclaration,
  block: AST.ConfigurationBlock,
): Compiled {
  const keyedDefaults = AST.configurationKeyOf(declaration)?.block.properties ?? []
  const configured = compileConfigurationObjectWithDefaults(block, keyedDefaults)
  const filled = AST.configurationPropertiesOf(declaration)
    .filter(Type.propertyIsFilled)
  const defaults = AST.configurationPropertiesOf(declaration)
    .filter(Type.propertyHasDefault)
    .filter(property => !block.entries.some(entry => entry.name === property.name))
  if (filled.length === 0 && defaults.length === 0) {
    return configured
  }
  return gen`{
    ...${configured},
    ${
    gen.list([...filled, ...defaults], property => {
      Assert.defined(property.value, 'filled/defaulted configuration slot has a value')
      return gen`${gen.jsLiteral(property.name)}: ${Compile.Expression(property.value)},`
    })
  }
  }`
}

function compileItemPatch(
  value: AST.RefinementExpression,
  base: AST.AliasDeclaration,
  itemType: ASTUtils.ItemShape,
): Compiled {
  const available = new Set(itemType.properties.filter(property => !Type.propertyIsFilled(property)))
  const pairs: Array<{ expected: AST.TypeProperty; compiled: Compiled }> = []
  for (const entry of value.patchBlock.entries) {
    if (entry.label && entry.expression) {
      const expected = itemType.properties.find(property => property.name === entry.label)
      Assert.defined(expected, 'validated item patch label resolves one slot')
      available.delete(expected)
      pairs.push({ expected, compiled: Compile.Expression(entry.expression) })
      continue
    }
    const named = entry.name
      ? itemType.properties.find(property => property.name === entry.name)
      : undefined
    const candidate = compileConfiguredItemEntry(entry, itemType)
    Assert.defined(candidate, 'validated item patch entry has a value')
    const expected = named
      ?? bindSingleSlot(available, candidate.type, 'validated item patch entry binds one slot')
    available.delete(expected)
    pairs.push({ expected, compiled: candidate.compiled })
  }
  return gen`TR.Value({
    ...${Compile.ValueDeclarationReference(base)}.jsValue,
    ${gen.list(pairs, pair => gen`[${gen.nameLiteral(pair.expected)}]: ${pair.compiled}.jsValue,`)}
  })`
}

function compileConfigurationPatchObject(
  block: AST.ConfigurationBlock,
  declaration?: AST.ConfigurableDeclaration,
): Compiled {
  const keyedDefaults = declaration ? AST.configurationKeyOf(declaration)?.block.properties ?? [] : []
  return gen`{
    ${
    gen.list(block.entries, entry => {
      if (entry.key && entry.block) {
        return gen`${gen.jsLiteral(entry.key)}: ${compileKeyedItemObject(entry.block, keyedDefaults)},`
      }
      Assert.defined(entry.name, 'validated patch entry has a property name')
      Assert.defined(entry.value, 'validated patch entry has a property value')
      return gen`${gen.jsLiteral(entry.name)}: ${Compile.ConfigurationValue(entry.value)},`
    })
  }
  }`
}

function inferredConfigurationDeclaration(
  value: AST.InferredConfigurationConstructor,
): AST.ConfigurableDeclaration | undefined {
  const declaration = Type.inferredConfigurationDeclaration(value)
  return declaration && AST.isConfigurableDeclaration(declaration) ? declaration : undefined
}

function configuredDeclarationOfValue(
  declaration: AST.ValueDeclaration,
  seen: Set<AST.ValueDeclaration> = new Set(),
): AST.ConfigurableDeclaration | undefined {
  if (seen.has(declaration)) {
    return undefined
  }
  seen.add(declaration)
  const expression = AST.isAppDeclaration(declaration)
      || AST.isNavDeclaration(declaration)
      || AST.isDatasourceDeclaration(declaration)
    ? declaration.value
    : AST.isAliasDeclaration(declaration)
    ? declaration.value
    : undefined
  if (!expression) {
    return undefined
  }
  const constructorDeclaration = AST.isConfigurationConstructor(expression) ? expression.type.ref : undefined
  if (constructorDeclaration && AST.isConfigurableDeclaration(constructorDeclaration)) {
    return constructorDeclaration
  }
  if (AST.isRefinementExpression(expression) || AST.isValueReference(expression)) {
    const target = expression.target.ref
    if (target && AST.isConfigurableDeclaration(target)) {
      return target
    }
    return AST.isValueDeclaration(target) ? configuredDeclarationOfValue(target, seen) : undefined
  }
  if (AST.isInferredConfigurationConstructor(expression) && AST.isAliasDeclaration(declaration)) {
    const inferred = Type.visibleDeclaration(declaration, declaration.name)
    return inferred && AST.isConfigurableDeclaration(inferred) ? inferred : undefined
  }
  return undefined
}

/**
 * A member path walks one segment at a time, because a segment's lowering depends on the type it
 * reads from: a unit of a family converts, a family's reading renders, and everything else is an
 * ordinary member read.
 */
function compileMemberPath(root: Compiled, rootType: ASTUtils.TaoType, members: readonly string[]): Compiled {
  let compiled = root
  let current = rootType
  let plainMembers: string[] = []
  const flushPlainMembers = () => {
    if (plainMembers.length > 0) {
      const names = plainMembers
      compiled = gen`TR.Member(${compiled}, [${gen.join(names, member => gen`${gen.jsLiteral(member)}`)}])`
      plainMembers = []
    }
  }
  for (const member of members) {
    const family = unitFamilyOf(current)
    if (family) {
      flushPlainMembers()
      const reading = Units.readingOf(family, member)
      compiled = reading
        ? gen`TR.Units.${reading}(${compiled})`
        : gen`TR.Units.Read(${compiled}, ${gen.jsLiteral(ratioOf(family, member))})`
      current = Type.unitMemberType(family, member) ?? { kind: 'unresolved' }
      continue
    }
    if (primitiveNamed(current, 'number') && Units.familyOf(member)) {
      flushPlainMembers()
      const constructed = Units.familyOf(member)!
      compiled = gen`TR.Units.Build(${compiled}, ${gen.jsLiteral(ratioOf(constructed, member))})`
      current = { kind: 'primitive', primitive: constructed }
      continue
    }
    plainMembers.push(member)
    current = Type.atMemberPath(current, [member])
  }
  flushPlainMembers()
  return compiled
}

/**
 * `time` is milliseconds and a duration is its family's base unit, so the pairs that mix them
 * convert rather than adding raw numbers. Same-family duration arithmetic needs no conversion and
 * stays on the ordinary numeric path.
 */
function compileCalendarArithmetic(expression: AST.BinaryExpression): Compiled | undefined {
  const left = Type.ofExpression(expression.left)
  const right = Type.ofExpression(expression.right)
  const leftCompiled = () => Compile.Expression(expression.left)
  const rightCompiled = () => Compile.Expression(expression.right)
  if (primitiveNamed(left, 'time') && primitiveNamed(right, 'time') && expression.operator === '-') {
    return gen`TR.Units.Between(${leftCompiled()}, ${rightCompiled()})`
  }
  if (primitiveNamed(left, 'time') && unitFamilyOf(right) === 'duration') {
    if (expression.operator === '+' || expression.operator === '-') {
      return gen`TR.Units.Shift(${leftCompiled()}, ${gen.jsLiteral(expression.operator)}, ${rightCompiled()})`
    }
  }
  return undefined
}

function unitFamilyOf(type: ASTUtils.TaoType): ASTUtils.UnitFamily | undefined {
  return type.kind === 'primitive' && Units.isFamily(type.primitive) ? type.primitive : undefined
}

function primitiveNamed(type: ASTUtils.TaoType, primitive: string): boolean {
  return type.kind === 'primitive' && type.primitive === primitive
}

function ratioOf(family: ASTUtils.UnitFamily, unit: string): number {
  const ratio = Units.ratioToBase(family, unit)
  Assert.defined(ratio, 'validated unit accessor names a unit of its family', { family, unit })
  return ratio
}
