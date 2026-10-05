import { ASTUtils, Type, Units } from '@ast-utils'
import { AST } from '@parser'
import { Assert, Switch } from '@shared'
import { BridgeMetadata } from '../../../bridge-metadata'
import { nativeNumericSelfContext } from '../../../numeric-self-context'
import { type Compiled, gen, resolveRef } from '../codegen-util'
import { Compile } from '../Compile'
import { compileAssociatedConversion } from './associated-converters'
import {
  compileAssociatedActionWitness,
  compileAssociatedWitness,
  compileCallableWitnessKey,
} from './AssociatedMethodsCompiler'
import {
  authLibraryExport,
  compileCurrentAccount,
  contextualCommand,
  contextualReference,
  needsAuthContext,
} from './auth-context'
import { compileArgumentForType, compileValueForType } from './capability-projection'
import { configurationRuntimeBindingName } from './ConfigurationCompiler'
import { activeDataStorePlan } from './data-store-context'
import { compileDeclarationIdentity } from './declaration-identity'
import { bridgeBindingName } from './injection-plan'
import { checkedNumericValue, compileNumericUnitReading, quantityFactoryBinding } from './NumericUnitsCompiler'
import { compileReactiveArgument } from './reactive-parameters'

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
      CopyExpression: Compile.CopyExpression,
      ConversionExpression: compileAssociatedConversion,
      ConfigurationConstructor: Compile.ConfiguredValue,
      WhenExpression: Compile.WhenExpression,
      FunctionCallExpression: Compile.FunctionCallExpression,
      MethodCallExpression: Compile.MethodCallExpression,
      InterpolatedString: Compile.InterpolatedString,
      InferredConfigurationConstructor: Compile.InferredConfiguration,
      NumberLiteral: Compile.NumberLiteral,
      NumericUnitConstruction: Compile.NumericUnitConstruction,
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

  CopyExpression(copy: AST.CopyExpression): Compiled {
    const target = copy.type ? Type.ofReference(copy.type) : undefined
    const fields = target?.kind === 'item' && target.item?.projectedEntity
      ? target.item.dataFields?.map(field => field.name) ?? []
      : undefined
    return fields
      ? gen`TR.Copy(${Compile.Expression(copy.value)}, ${gen.jsLiteral(fields)})`
      : gen`TR.Copy(${Compile.Expression(copy.value)})`
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
    if (
      AST.isTypeDeclaration(declaration) || AST.isParameterTypeDeclaration(declaration)
      || AST.isParameterizedDeclaration(declaration)
    ) {
      if (value.value) {
        return checkedNumericValue(Compile.Expression(value.value), resolvedType)
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
      ListLiteral: Compile.Expression,
      // A conditional or absent member compiles as the ordinary expression it is; the runtime reads
      // it on every render, which is what makes an absent member reactive.
      NoneLiteral: Compile.Expression,
      NumberLiteral: Compile.Expression,
      NumericUnitConstruction: Compile.Expression,
      PropertyConfigurationPatch: value =>
        Assert.never(value as never, 'property-position with is compiled against its owning property'),
      StringLiteral: Compile.Expression,
      ViewBinding: compileViewBinding,
      WhenExpression: Compile.Expression,
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
    return gen`TR.Value(${value.value === 'true' || value.value === 'yes' ? 'true' : 'false'})`
  },

  /** NoneLiteral compiles Tao absence to JavaScript null behind a Tao value. */
  NoneLiteral(): Compiled {
    return gen`TR.Value(null)`
  },

  /** BinaryExpression delegates Tao operator semantics to the runtime. */
  BinaryExpression(expression: AST.BinaryExpression): Compiled {
    const associated = compileAssociatedOperation(expression)
    if (associated) {
      return associated
    }
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
    const associated = compileAssociatedOperation(expression)
    if (associated) {
      return associated
    }
    return gen`TR.Unary(${gen.jsLiteral(expression.operator)}, ${Compile.Expression(expression.operand)})`
  },

  /** CaseTestExpression compares one subject with a built-in or declaration-linked case. */
  CaseTestExpression(expression: AST.CaseTestExpression): Compiled {
    let test: Compiled
    if (expression.builtinCase) {
      test = gen`TR.IsCase(${Compile.Expression(expression.value)}, ${
        gen.jsLiteral(AST.canonicalSubjectCase(expression.builtinCase))
      })`
    } else {
      Assert.defined(expression.declaredCase, 'parsed case test has a declared or built-in case')
      const declaredCase = resolveRef(expression.declaredCase)
      test = AST.isEntityDataField(declaredCase)
        ? gen`TR.IsCase(${Compile.Expression(expression.value)}, TR.Value(${
          expression.declaredCase.$refText === declaredCase.name ? 'true' : 'false'
        }))`
        : gen`TR.IsCase(${Compile.Expression(expression.value)}, ${Compile.ValueDeclarationReference(declaredCase)})`
    }
    return expression.negated ? gen`TR.Unary('not', ${test})` : test
  },

  /** WhenExpression evaluates one subject and selects one lazy value case. */
  WhenExpression(expression: AST.WhenExpression): Compiled {
    if (!expression.subject) {
      if (!expression.otherwise) {
        Assert(expression.pickSyntax, 'only a validated exhaustive pick can omit its fallback')
      }
      const fallback = expression.otherwise
        ? Compile.Expression(expression.otherwise.value)
        : gen`TR.Errors.failInvariant("A validated exhaustive pick did not match.")`
      return gen`(() => {
        ${
        gen.list(expression.branches, branch => {
          Assert.defined(branch.condition, 'predicate match branch has a condition')
          return gen`if (${Compile.Expression(branch.condition)}.evaluate().jsValue === true) return ${
            Compile.Expression(branch.value)
          }`
        })
      }
        return ${fallback}
      })()`
    }
    // The compact form is the two-outcome sibling of the block form, so it lowers to the same case
    // switch: the positive case is `true`, and an omitted negative outcome is absence.
    if (expression.positive) {
      const negative = expression.negative
      return gen`TR.WhenCase(${Compile.Expression(expression.subject)}, [
        ['true', () => ${Compile.Expression(expression.positive)}],
      ], () => ${negative ? Compile.Expression(negative) : gen`TR.Value(null)`})`
    }
    if (!expression.otherwise) {
      Assert(expression.pickSyntax, 'only a validated exhaustive pick can omit its fallback')
    }
    const otherwise = expression.otherwise
      ? gen`() => ${Compile.Expression(expression.otherwise.value)}`
      : gen`() => TR.Errors.failInvariant("A validated exhaustive pick did not match.")`
    return gen`TR.WhenCase(${Compile.Expression(expression.subject)}, [
      ${
      gen.list(
        expression.branches,
        branch =>
          gen`[${gen.jsLiteral(AST.canonicalSubjectCase(branch.case!))}, () => ${Compile.Expression(branch.value)}],`,
      )
    }
    ], ${otherwise})`
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

  /**
   * FunctionCallExpression invokes a pure function or named copy with owner-bound arguments; both
   * share this one call shape (Decisions §14). A parameterless phrase's zero-argument call form
   * (`DocumentGone()`) compiles the same way as its bare reference (`ValueDeclarationReference`).
   */
  FunctionCallExpression(expression: AST.FunctionCallExpression): Compiled {
    const resolved = ASTUtils.resolveFunctionInvocation(expression)
    const fn = resolved.function
    Assert.defined(fn, 'validated function call resolves its declaration')
    Assert(resolved.diagnostics.length === 0, 'validated function call has no binding diagnostics')
    Assert(!resolved.genericDiagnostics?.length, 'validated generic call has one bounded type substitution')
    const parameters = AST.parametersOf(fn)
    const argumentsByParameter = new Map(resolved.pairs.map(pair => [pair.parameter, pair.argument]))
    const lastProvidedIndex = Math.max(...resolved.pairs.map(pair => parameters.indexOf(pair.parameter)), -1)
    return gen`TR.Call(${contextualReference(fn)}${
      gen.join(
        parameters.slice(0, lastProvidedIndex + 1),
        parameter => {
          const argument = argumentsByParameter.get(parameter)
          return argument
            ? gen`, ${
              compileGenericArgument(
                argument,
                resolved.transportTypes?.get(parameter) ?? Type.ofParameter(parameter),
                resolved.parameterTypes?.get(parameter),
              )
            }`
            : gen`, undefined`
        },
        { separator: '' },
      )
    })`
  },

  /** Method calls use the canonical selected descriptor and its parameter correspondence. */
  MethodCallExpression(expression: AST.MethodCallExpression): Compiled {
    const target = ASTUtils.associatedMethodCallTarget(expression)
    const staticCall = !!target && Type.associatedMethodTypeRoot(target.receiver) !== undefined
    const reading = staticCall ? { kind: 'not-unit-reading' } as const : ASTUtils.resolveNumericUnitReading(expression)
    if (reading.kind !== 'not-unit-reading') {
      Assert(reading.kind === 'unit-reading', 'validated unit reading has no argument or method collision')
      return compileNumericUnitReading(reading.reading, compileMethodReceiver(reading.reading.receiverAnchor))
    }
    const resolved = ASTUtils.resolveAssociatedMethodInvocation(expression)
    Assert(resolved.problem === undefined, 'validated associated call resolves its receiver and contract')
    Assert.defined(resolved.descriptor, 'validated associated call has a selected descriptor')
    Assert(resolved.diagnostics.length === 0, 'validated associated call has no binding diagnostics')
    Assert(!resolved.genericDiagnostics?.length, 'validated generic associated call has one bounded type substitution')
    Assert.defined(target, 'validated associated call retains its actual receiver anchor')
    const receiver = staticCall ? undefined : compileMethodReceiver(target.receiver)
    const capability = !staticCall
      && (resolved.receiver?.kind === 'capability' || !!resolved.receiver?.genericParameter)
    const rebindSelf = capability && !!resolved.receiver?.genericParameter
      && resolved.descriptor.result.genericParameter === resolved.receiver.genericParameter
    const callable = capability
      ? gen`TR.Capability.method(${rebindSelf ? gen`_TaoGenericReceiver` : gen`${receiver}.evaluate()`}, ${
        gen.jsLiteral(compileCallableWitnessKey(resolved.descriptor))
      })`
      : compileAssociatedWitness(resolved.descriptor)
    const parameters = AST.parametersOf(resolved.descriptor.declaration)
    const argumentsByParameter = new Map(resolved.pairs.map(pair => [pair.parameter, pair.argument]))
    const lastProvidedIndex = Math.max(...resolved.pairs.map(pair => parameters.indexOf(pair.parameter)), -1)
    const call = gen`TR.Call(${callable}${capability || staticCall ? gen.noop() : gen`, ${receiver}`}${
      gen.join(parameters.slice(0, lastProvidedIndex + 1), parameter => {
        const argument = argumentsByParameter.get(parameter)
        const expected = resolved.transportTypes?.get(parameter) ?? Type.ofParameter(parameter)
        return argument
          ? gen`, ${compileGenericArgument(argument, expected, resolved.parameterTypes?.get(parameter))}`
          : gen`, undefined`
      }, { separator: '' })
    })`
    return rebindSelf
      ? gen`(() => {
        const _TaoGenericReceiver = ${receiver}.evaluate()
        return TR.Capability.rebind(_TaoGenericReceiver, ${call})
      })()`
      : call
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
        pair =>
          gen`[${gen.nameLiteral(pair.expected)}]: ${
            itemFieldStorage(
              compileArgumentForType(pair.property.value, Type.itemFieldType(pair.expected)),
              pair.expected,
            )
          },`,
      )
    }
    })`
  },

  /** MemberAccessExpression compiles a typed item member path into a runtime value wrapper. */
  MemberAccessExpression(reference: AST.MemberAccessExpression): Compiled {
    const associatedAction = compileAssociatedActionSelection(reference)
    if (associatedAction) {
      return associatedAction
    }
    const target = resolveRef(reference.target)
    if (reference.shade !== undefined) {
      Assert(AST.isDesignColorEntry(target), 'validated shade names a design color family member')
      return compileDesignColorValue(AST.designColorPath(target, reference.shade))
    }
    if (AST.isTypeDeclaration(target) || AST.isEntityDataDeclaration(target)) {
      Assert(
        AST.associatedReceiverOwner(reference) === target,
        'validated type reference names the contextual receiver',
      )
      return compileMemberPath(
        contextualReceiverReference(reference, target),
        Type.ofReferenceRoot(reference),
        reference.members,
      )
    }
    const root = Compile.ValueDeclarationReference(target)
    return compileMemberPath(root, Type.ofValueDeclaration(target), reference.members)
  },

  /**
   * FromExpression preserves quantity arguments and passes ordinary arguments as JavaScript data.
   */
  FromExpression(bridge: AST.FromExpression): Compiled {
    const call = bridge.expression
    const values = AST.isFunctionCallExpression(call)
      ? (call.argumentList?.arguments ?? []).map(argument => {
        const value = Compile.Expression(argument.value)
        const type = Type.ofExpression(argument.value)
        if (type.kind === 'capability') {
          return gen`${value}.evaluate()`
        }
        if (Type.quantityOwner(type) || abstractNumericDomain(type)) {
          return value
        }
        return typeContainsQuantity(type)
          ? gen`(() => { const result = ${value}; const backing = result.jsValue; return TR.isQuantityPayload(backing) ? result : backing })()`
          : gen`${value}.jsValue`
      })
      : undefined
    const binding = gen.Name({ name: bridgeBindingName(bridge) })
    const contextual = AST.getDocument(bridge).uri.path.endsWith('/@tao/auth/Auth.tao')
    if (values && nativeNumericSelfContext(bridge)) {
      values.push(gen`_TaoSelfFactory`)
    }
    const nativeValue = contextual
      ? gen`${binding}(_TaoAuthScope!${values?.length ? gen`, ${gen.join(values, value => value)}` : gen.noop()})`
      : values
      ? gen`${binding}(${gen.join(values, value => value)})`
      : binding
    const resultType = BridgeMetadata.bridgeResultType(bridge)
    if (resultType) {
      if (resultType.kind === 'enum') {
        return gen`TR.EnumFromJS(${gen.scopeName(resultType.declaration)}, ${nativeValue})`
      }
      if (resultType.kind === 'primitive' && resultType.primitive === 'numeric' && resultType.selfOwner) {
        return gen`(() => {
          const result = ${nativeValue};
          TR.admitQuantityUnion(result, [_TaoSelfFactory], "Self");
          return result;
        })()`
      }
      const members = nativeResultMembers(resultType)
      Assert(
        !members.some(abstractNumericDomain),
        'validated native return has a checked concrete quantity owner contract',
      )
      const owners = [...new Set(members.map(Type.quantityOwner).filter(owner => owner !== undefined))]
      if (owners.length) {
        const ordinaryPlans = members.filter(member => !Type.quantityOwner(member))
          .sort((left, right) => Number(primitiveNamed(left, 'numeric')) - Number(primitiveNamed(right, 'numeric')))
          .map(nativePrimitiveResultBranch)
        const ordinaryBranches = ordinaryPlans.filter(branch => branch !== undefined)
        const ambiguousData = ordinaryPlans.some(branch => branch === undefined)
        return gen`(() => {
          const result = ${nativeValue};
          ${gen.list(ordinaryBranches, branch => branch)}
          ${
          ambiguousData
            ? gen`if (!TR.isRuntimeValue(result) && !TR.isQuantityPayload(result)) return TR.Value(result);`
            : gen.noop()
        }
          TR.admitQuantityUnion(result, [${gen.join(owners, owner => gen`${quantityFactoryBinding(owner)}`)}], ${
          gen.jsLiteral(Type.displayName(resultType))
        });
          return result
        })()`
      }
    }
    return resultType?.kind === 'primitive' && resultType.primitive === 'numeric'
      ? gen`TR.Value(TR.checkedNumericBacking(${nativeValue}, ${
        gen.jsLiteral(
          resultType.nominal && AST.isTypeDeclaration(resultType.nominal) ? resultType.nominal.name : 'numeric',
        )
      }))`
      : gen`TR.Value(${nativeValue})`
  },

  /** PostfixMemberAccess compiles a member read on any expression, including unit accessors. */
  PostfixMemberAccess(access: AST.PostfixMemberAccess): Compiled {
    const associatedAction = compileAssociatedActionSelection(access)
    if (associatedAction) {
      return associatedAction
    }
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
    if (AST.isTypeDeclaration(target) || AST.isEntityDataDeclaration(target)) {
      Assert(
        AST.associatedReceiverOwner(reference) === target,
        'validated type reference names the contextual receiver',
      )
      return gen`${contextualReceiverReference(reference, target)}.evaluate()`
    }
    return Compile.ValueDeclarationReference(target)
  },

  /** ValueDeclarationReference compiles an alias or parameter declaration reference. */
  ValueDeclarationReference(target: AST.ValueDeclaration): Compiled {
    if (authLibraryExport(target) === 'Account') {
      return compileCurrentAccount()
    }
    return Switch.type(target, {
      ActionDeclaration: action => gen`${contextualReference(action)}.evaluate()`,
      AliasDeclaration: alias => gen`${contextualReference(alias)}.evaluate()`,
      AppDeclaration: app => gen`${gen.Name({ name: `_TaoAppDefinition_${app.name}` })}`,
      ActionResultStatement: result => gen`${gen.scopeName(result)}.evaluate()`,
      AskStatement: ask => gen`${gen.scopeName(ask)}.evaluate()`,
      CasePayload: payload => gen`${gen.scopeName(payload)}.evaluate()`,
      CommandDeclaration: command => gen`${contextualCommand(command)}.evaluate()`,
      DesignDeclaration: design => gen`${gen.scopeName(design)}.evaluate()`,
      DesignColorEntry: color => compileDesignColorValue(AST.designColorPath(color)),
      DesignToken: token => compileDesignColorValue(AST.designColorPath(token)),
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
      RenderSlotInputBinding: binding => gen`${gen.scopeName({ name: binding.name })}.evaluate()`,
      // A phrase compiles to a callable `TR.Function`; a bare reference is its zero-argument call.
      PhraseDeclaration: phrase => gen`TR.Call(${contextualReference(phrase)})`,
      StateDeclaration: state => gen`${gen.scopeName(state)}.evaluate()`,
      ViewDeclaration: view => Compile.ViewValue(view),
    })
  },

  /** ViewValue creates the presentation descriptor a view evaluates to in value position. */
  ViewValue(view: AST.ViewDeclaration): Compiled {
    return compileNavigationDescriptor(view)
  },
} as const

/** Selection binds the validated receiver once; invoking an alias reads its captured action. */
function compileAssociatedActionSelection(
  expression: AST.MemberAccessExpression | AST.PostfixMemberAccess,
): Compiled | undefined {
  const selected = ASTUtils.resolveActionTarget(expression)
  if (selected.kind !== 'named' || !selected.associated) {
    return undefined
  }
  Assert(AST.isActionDeclaration(selected.action), 'an associated action selection names a source action')
  const receiver = selected.associated
  const declared = AST.associatedEntityActionReceiver(selected.action)
  Assert(
    declared?.owner === receiver.owner && declared.cardinality === receiver.cardinality,
    'the validated associated action retains its actual receiver owner and cardinality',
  )
  const hasOwner = AST.findOwningView(expression) || AST.findOwningAssociatedView(expression)
  const needsAuth = needsAuthContext(selected.action)
  const options = hasOwner ? gen`, { owner: _TaoActionOwner }` : needsAuth ? gen`, {}` : gen.noop()
  return gen`${compileAssociatedActionWitness(selected.action)}(TR.CaptureActionReceiver(${
    compileMethodReceiver(receiver.receiver)
  }, ${gen.jsLiteral(receiver.cardinality)})${options}${needsAuth ? gen`, _TaoAuthScope` : gen.noop()})`
}

/** Selected operators call the real ordered contract before any built-in runtime leaf. */
function compileAssociatedOperation(expression: AST.BinaryExpression | AST.UnaryExpression): Compiled | undefined {
  const resolved = Type.associatedOperation(expression)
  if (resolved.problem) {
    const builtIn = resolved.problem === 'unsupported-operator'
      || (resolved.problem === 'missing-operator' && Type.ofExpression(expression).kind !== 'unresolved')
    Assert(builtIn, 'a validated operation has one authored contract or a resolved built-in domain')
    return undefined
  }
  Assert.defined(resolved.descriptor, 'a selected operation retains its defining callable')
  const descriptor = resolved.descriptor
  const receiverType = resolved.operandTypes[0]!
  const capability = resolved.dispatch === 'instance'
    && (receiverType.kind === 'capability' || !!receiverType.genericParameter)
  const rebindSelf = capability && !!receiverType.genericParameter
    && descriptor.result.genericParameter === receiverType.genericParameter
  const receiver = resolved.receiver ? Compile.Expression(resolved.receiver) : undefined
  const callable = capability
    ? gen`TR.Capability.method(${rebindSelf ? gen`_TaoGenericReceiver` : gen`${receiver}.evaluate()`}, ${
      gen.jsLiteral(compileCallableWitnessKey(descriptor))
    })`
    : compileAssociatedWitness(descriptor)
  const call = gen`TR.Call(${callable}${
    resolved.dispatch === 'instance' && !capability ? gen`, ${receiver}` : gen.noop()
  }${gen.join(resolved.pairs, pair => gen`, ${compileArgumentForType(pair.operand, pair.type)}`, { separator: '' })})`
  return rebindSelf
    ? gen`(() => {
      const _TaoGenericReceiver = ${receiver}.evaluate()
      return TR.Capability.rebind(_TaoGenericReceiver, ${call})
    })()`
    : call
}

/**
 * A `color` value is the design color's name, never its hex: the mounted design resolves it at render,
 * so a derived color follows `Scheme` and each app that mounts the view reads its own design.
 */
function compileGenericArgument(
  argument: AST.Argument,
  transport: ASTUtils.TaoType,
  instantiated?: ASTUtils.TaoType,
): Compiled {
  const role = Type.genericRoleConstructor(argument)
  if (!role && !transport.genericParameter) {
    return compileArgumentForType(argument.value, transport)
  }
  const payload = role?.value ?? argument.value
  const actual = Type.ofExpression(payload)
  const target = instantiated ?? actual
  // A contextual backing is constructed in inferred T; already typed wrappers keep their owner.
  if (actual.kind === 'primitive' && !actual.nominal && target.kind === 'primitive' && target.nominal) {
    const owner = Type.quantityOwner(target)
    const value = owner
      ? gen`${quantityFactoryBinding(owner)}.fromJSValue(${Compile.Expression(payload)}.jsValue)`
      : checkedNumericValue(Compile.Expression(payload), target)
    return compileValueForType(value, target, transport)
  }
  const source = ASTUtils.containsCapability(transport) ? compileReactiveArgument(payload) : Compile.Expression(payload)
  return compileValueForType(source, actual, transport)
}

function compileDesignColorValue(path: string): Compiled {
  return gen`TR.Value(${gen.jsLiteral(path)})`
}

function compileNavigationDescriptor(
  declaration: AST.ViewDeclaration,
): Compiled {
  return gen`TR.Navigation.ViewReference(${compileDeclarationIdentity(declaration)})`
}

function itemPropertyBindingPairs(
  item: AST.ItemLiteral,
  itemType: ASTUtils.ItemShape,
): ASTUtils.ItemPropertyBindingPair[] {
  const result = ASTUtils.resolveItemPropertyBindings(itemType.properties, item.properties)
  Assert(result.diagnostics.length === 0, 'validated item constructor has no binding diagnostics')
  return result.pairs
}

/** Contextual entity references select their actual bound row or collection, not the catalog name. */
function contextualReceiverReference(
  reference: AST.ValueReference | AST.MemberAccessExpression,
  owner: AST.TypeDeclaration | AST.EntityDataDeclaration,
): Compiled {
  if (!AST.isEntityDataDeclaration(owner)) {
    return gen.scopeName(owner)
  }
  return gen.scopeName({
    name: AST.associatedReceiverBindingName(reference)!,
  })
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
  const fields = Type.itemFields(itemType)
  const remaining = new Set<ASTUtils.ItemShapeField>(fields.filter(property => !Type.itemFieldIsFilled(property)))
  const pairs: Array<{ expected: ASTUtils.ItemShapeField; compiled: Compiled }> = fields
    .filter(Type.itemFieldIsFilled)
    .map(expected => {
      Assert.defined(expected.value, 'filled item slot has a value')
      return { expected, compiled: compileArgumentForType(expected.value, Type.itemFieldType(expected)) }
    })
  for (const entry of block.entries) {
    if (entry.label && entry.expression) {
      const expected = fields.find(property => property.name === entry.label)
      Assert.defined(expected, 'validated configured item label resolves one field')
      remaining.delete(expected)
      pairs.push({ expected, compiled: compileArgumentForType(entry.expression, Type.itemFieldType(expected)) })
      continue
    }
    const candidate = compileConfiguredItemEntry(entry, itemType)
    Assert.defined(candidate, 'validated configured item entry has a constructable value')
    const expected = bindSingleSlot(remaining, candidate.type, 'validated configured item entry binds one field')
    remaining.delete(expected)
    pairs.push({
      expected,
      compiled: compileValueForType(
        ASTUtils.containsCapability(Type.itemFieldType(expected))
          ? gen`TR.Alias(() => ${candidate.compiled})`
          : candidate.compiled,
        candidate.type,
        Type.itemFieldType(expected),
      ),
    })
  }
  for (const expected of [...remaining]) {
    if (!AST.isTypeProperty(expected) || !Type.propertyHasDefault(expected)) {
      continue
    }
    Assert.defined(expected.value, 'defaulted item slot has a value')
    pairs.push({ expected, compiled: compileArgumentForType(expected.value, Type.itemFieldType(expected)) })
    remaining.delete(expected)
  }
  Assert(
    [...remaining].every(property => !Type.itemFieldRequiresValue(property)),
    'validated configured item constructor binds every required field',
  )
  pairs.sort((left, right) => fields.indexOf(left.expected) - fields.indexOf(right.expected))
  return gen`TR.Value({
    ${
    gen.list(
      pairs,
      pair => gen`[${gen.nameLiteral(pair.expected)}]: ${itemFieldStorage(pair.compiled, pair.expected)},`,
    )
  }
  })`
}

function itemFieldStorage(value: Compiled, field: ASTUtils.ItemShapeField): Compiled {
  return ASTUtils.containsCapability(Type.itemFieldType(field))
    ? gen`TR.Capability.storedValue(${value})`
    : gen`${value}.jsValue`
}

function compileConfiguredItemEntry(
  entry: AST.ConfigurationEntry,
  itemType: ASTUtils.ItemShape,
): { compiled: Compiled; type: ASTUtils.TaoType } | undefined {
  if (entry.expression) {
    return { compiled: Compile.Expression(entry.expression), type: Type.ofExpression(entry.expression) }
  }
  // A membership entry names a data collection rather than a value, and membership is compiled as
  // the store partition rather than as anything inside the configured value.
  if (entry.reference?.ref && AST.isValueDeclaration(entry.reference.ref)) {
    const declaration = entry.reference.ref
    return {
      compiled: Compile.ValueDeclarationReference(declaration),
      type: Type.ofValueDeclaration(declaration),
    }
  }
  if (entry.name && entry.value) {
    const ownerProperty = Type.itemFields(itemType).find(property => property.name === entry.name)
    if (ownerProperty) {
      return {
        compiled: Compile.ConfigurationValue(entry.value),
        type: Type.itemFieldType(ownerProperty),
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
    const runtimeDeclaration = gen.scopeName(declaration, configurationRuntimeBindingName(declaration))
    return gen`TR.Navigation.Configure(${runtimeDeclaration}, ${config})`
  }
  if (primitive === 'auth') {
    return gen`TR.Auth.Configure(${
      gen.scopeName(declaration, configurationRuntimeBindingName(declaration))
    }, ${config})`
  }
  return primitive === 'datasource' ? dataConfigureCall(declaration, config) : undefined
}

function dataConfigureCall(declaration: AST.ConfigurableDeclaration, config: Compiled): Compiled {
  const runtimeDeclaration = gen.scopeName(declaration, configurationRuntimeBindingName(declaration))
  return gen`TR.Data.Configure(${runtimeDeclaration}, ${config})`
}

/** bindSingleSlot picks the one unfilled slot an entry binds: an exact identity match wins, else assignability. */
function bindSingleSlot(
  remaining: ReadonlySet<ASTUtils.ItemShapeField>,
  actual: ASTUtils.TaoType,
  message: string,
): ASTUtils.ItemShapeField {
  const exact = [...remaining].filter(property =>
    Type.identityKey(Type.itemFieldType(property)) === Type.identityKey(actual)
  )
  const assignable = exact.length === 1
    ? exact
    : [...remaining].filter(property => Type.isAssignableToConstruction(actual, Type.itemFieldType(property)))
  Assert(assignable.length === 1, message)
  return assignable[0]!
}

function compileConfigurationReference(value: AST.ConfigurationReference): Compiled {
  const target = resolveRef(value.target)
  if (AST.isConfigurableDeclaration(target)) {
    return configureCall(target, gen`{}`) ?? gen`TR.Value({})`
  }
  if (AST.isViewDeclaration(target)) {
    return Compile.ViewValue(target)
  }
  if (
    AST.isAliasDeclaration(target)
    || AST.isDesignDeclaration(target)
    || AST.isNavDeclaration(target)
    || AST.isDatasourceDeclaration(target)
  ) {
    return Compile.ValueDeclarationReference(target)
  }
  if (AST.isStateDeclaration(target)) {
    return gen`${gen.scopeName(target)}`
  }
  return Assert.never(target as never, 'validated configuration reference targets a configurable declaration')
}

function compileViewBinding(binding: AST.ViewBinding): Compiled {
  const view = resolveRef(binding.view)
  const resolved = ASTUtils.resolveArgumentBindings(view, binding)
  Assert(resolved.diagnostics.length === 0, 'validated bound view has no binding diagnostics')
  return gen`TR.Navigation.BindView(
    ${Compile.ViewValue(view)},
    { ${gen.list(resolved.pairs, Compile.BoundViewArgument)} },
  )`
}

function compileConfigurationObject(block: AST.ConfigurationBlock): Compiled {
  return compileConfigurationObjectWithDefaults(block, [])
}

/** compileConfigurationObjectWithDefaults renders a block whose keyed items, not the block itself, fill the key defaults. */
function compileConfigurationObjectWithDefaults(
  block: AST.ConfigurationBlock,
  keyedDefaults: readonly AST.ConfigurationProperty[],
  entries: readonly AST.ConfigurationEntry[] = block.entries,
): Compiled {
  return gen`{
    ${compileConfigurationEntries(block, keyedDefaults, entries)}
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

/**
 * Binding a command is derivation: the fills settle the slots the declaration left open, and any
 * member written beside them refines the words a host shows for this one binding.
 */
function compileCommandBinding(command: AST.CommandDeclaration, block: AST.ConfigurationBlock): Compiled {
  const slots = new Set(ASTUtils.commandSlots(command).map(slot => slot.name))
  const bindings = block.entries.flatMap(entry => {
    const name = AST.configurationEntryName(entry)
    const expression = commandBindingExpression(entry)
    return name === undefined || expression === undefined ? [] : [{ expression, name }]
  })
  const compileGroup = (members: typeof bindings) =>
    gen`{ ${gen.list(members, member => gen`${gen.jsLiteral(member.name)}: ${member.expression},`)} }`
  return gen`TR.Interaction.Bind(
    ${gen.scopeName(command)},
    ${compileGroup(bindings.filter(binding => slots.has(binding.name)))},
    ${
    compileGroup(
      bindings.filter(binding => !slots.has(binding.name)).map(binding => ({
        expression: gen`() => ${binding.expression}`,
        name: binding.name,
      })),
    )
  },
  )`
}

function commandBindingExpression(entry: AST.ConfigurationEntry): Compiled | undefined {
  if (entry.reference) {
    const declaration = resolveRef(entry.reference)
    Assert.is(declaration, AST.isValueDeclaration, 'validated command surface entry references a value')
    return Compile.ValueDeclarationReference(declaration)
  }
  if (entry.expression) {
    return compileReactiveArgument(entry.expression)
  }
  return entry.value && !AST.isPropertyConfigurationPatch(entry.value)
    ? Compile.ConfigurationValue(entry.value)
    : undefined
}

function compileConfigurationEntries(
  block: AST.ConfigurationBlock,
  keyedDefaults: readonly AST.ConfigurationProperty[],
  entries: readonly AST.ConfigurationEntry[] = block.entries,
): Compiled {
  return gen.list(entries, entry => {
    if (entry.key && entry.block) {
      return gen`${gen.jsLiteral(entry.key)}: ${compileKeyedItemObject(entry.block, keyedDefaults)},`
    }
    if (entry.name === 'Offline' && entry.block) {
      return gen`"Offline": ${gen.jsLiteral(entry.block.entries.map(compileOfflineScope))},`
    }
    if (entry.name && entry.block) {
      // A configured nav reads the same `Toolbar` slot a scene does, so it lists the same commands.
      const references = entry.block.entries.flatMap(referenceEntry => {
        const reference = referenceEntry.reference?.ref
        return AST.isCommandDeclaration(reference) ? [reference] : []
      })
      // A nav is configured where it is declared, which can be above the commands it lists.
      return gen`${gen.jsLiteral(entry.name)}: [${
        gen.join(references, reference => gen`TR.Interaction.Deferred(() => ${gen.scopeName(reference)})`)
      }],`
    }
    Assert.defined(entry.name, 'validated configuration entry has a property name')
    Assert.defined(entry.value, 'validated configuration property has a value')
    Assert(!AST.isPropertyConfigurationPatch(entry.value), 'configuration property patch is compiled by its owner')
    return gen`${gen.jsLiteral(entry.name)}: ${Compile.ConfigurationValue(entry.value)},`
  })
}

function compileConfiguredPatch(value: AST.RefinementExpression): Compiled {
  const base = resolveRef(value.target)
  if (AST.isCommandDeclaration(base)) {
    return compileCommandBinding(base, value.patchBlock)
  }
  Assert.is(base, AST.isValueDeclaration, 'validated refinement target is a value')
  const compiledBase = Compile.ValueDeclarationReference(base)
  const patch = compileConfigurationPatchObject(
    value.patchBlock,
    configuredDeclarationOfValue(base),
  )
  const type = Type.ofValueDeclaration(base)
  if (type.kind === 'primitive' && type.primitive === 'nav') {
    return gen`TR.Navigation.Patch(${compiledBase}, ${patch})`
  }
  if (type.kind === 'primitive' && type.primitive === 'datasource') {
    return gen`TR.Data.Patch(${compiledBase}, ${patch})`
  }
  if (AST.isAliasDeclaration(base) && AST.configuredPrimitiveOfExpression(base.value) === 'auth') {
    return gen`TR.Auth.Patch(${compiledBase}, ${patch})`
  }
  if (type.kind === 'item') {
    if (type.item) {
      Assert.is(base, AST.isAliasDeclaration, 'item refinements target immutable let values')
      return compileItemPatch(value, base, type.item)
    }
    return gen`TR.Data.Patch(${Compile.ValueDeclarationReference(base)}, ${patch})`
  }
  return Assert.never(type as never, 'validated configured patch targets nav, datasource, or an item')
}

function compileConfiguredTypeObject(
  declaration: AST.ConfigurableDeclaration,
  block: AST.ConfigurationBlock,
): Compiled {
  const keyedDefaults = AST.configurationKeyOf(declaration)?.block.properties ?? []
  const declaredNames = new Set(AST.configurationPropertiesOf(declaration).map(property => property.name))
  const entries = configurationEntriesFor(declaration, block)
  const hostSlotEntries = entries.filter(entry => entry.name && !declaredNames.has(entry.name))
  const hostSlotEntrySet = new Set(hostSlotEntries)
  const configured = compileConfigurationObjectWithDefaults(
    block,
    keyedDefaults,
    entries.filter(entry => !hostSlotEntrySet.has(entry)),
  )
  const withHostSlots = gen`{
    ...${configured},
    "__taoHostSlots": {
      ${compileConfigurationEntries(block, keyedDefaults, hostSlotEntries)}
    },
  }`
  const filled = AST.configurationPropertiesOf(declaration)
    .filter(Type.propertyIsFilled)
  const defaults = AST.configurationPropertiesOf(declaration)
    .filter(Type.propertyHasDefault)
    .filter(property => !block.entries.some(entry => entry.name === property.name))
  if (filled.length === 0 && defaults.length === 0) {
    return withHostSlots
  }
  return gen`{
    ...${withHostSlots},
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
  const fields = Type.itemFields(itemType)
  const available = new Set<ASTUtils.ItemShapeField>(fields.filter(property => !Type.itemFieldIsFilled(property)))
  const pairs: Array<{ expected: ASTUtils.ItemShapeField; compiled: Compiled }> = []
  for (const entry of value.patchBlock.entries) {
    if (entry.label && entry.expression) {
      const expected = fields.find(property => property.name === entry.label)
      Assert.defined(expected, 'validated item patch label resolves one slot')
      available.delete(expected)
      pairs.push({ expected, compiled: Compile.Expression(entry.expression) })
      continue
    }
    const named = entry.name
      ? fields.find(property => property.name === entry.name)
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
  const declaredNames = new Set(
    declaration ? AST.configurationPropertiesOf(declaration).map(property => property.name) : [],
  )
  const entries = configurationEntriesFor(declaration, block)
  const hostSlotEntries = declaration
    ? entries.filter(entry => entry.name && !declaredNames.has(entry.name))
    : []
  const hostSlotEntrySet = new Set(hostSlotEntries)
  return gen`{
    ${
    compileConfigurationEntries(
      block,
      keyedDefaults,
      block.entries.filter(entry => !hostSlotEntrySet.has(entry)),
    )
  }
    ${
    hostSlotEntries.length > 0
      ? gen`"__taoHostSlots": {
        ${compileConfigurationEntries(block, keyedDefaults, hostSlotEntries)}
      },`
      : gen.noop()
  }
  }`
}

/**
 * A datasource's membership is structural: the compiler partitions the catalog with it and the
 * provider never sees it, so it is dropped before a configured value is built rather than travelling
 * as a host slot no provider reads.
 */
function configurationEntriesFor(
  declaration: AST.ConfigurableDeclaration | undefined,
  block: AST.ConfigurationBlock,
): readonly AST.ConfigurationEntry[] {
  if (!declaration || AST.configurationPrimitiveOf(declaration) !== 'datasource') {
    return block.entries
  }
  return block.entries.filter(entry => entry.name !== ASTUtils.datasourceMembershipSlot)
}

function inferredConfigurationDeclaration(
  value: AST.InferredConfigurationConstructor,
): AST.ConfigurableDeclaration | undefined {
  const declaration = Type.inferredConfigurationDeclaration(value)
  return declaration && AST.isConfigurableDeclaration(declaration) ? declaration : undefined
}

/** configuredDeclarationOfValue returns the reusable configuration type a value is built from. */
export function configuredDeclarationOfValue(
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

/** Method receivers retain the same live expression or authored member-path storage. */
function compileMethodReceiver(receiver: ASTUtils.AssociatedMethodReceiver): Compiled {
  return Switch.kind(receiver, {
    expression: value => compileReactiveArgument(value.expression),
    'member-path': value => {
      const site = value.site
      const declaration = resolveRef(site.target)
      const root = AST.isTypeDeclaration(declaration) || AST.isEntityDataDeclaration(declaration)
        ? gen.scopeName(declaration)
        : gen`TR.Alias(() => ${Compile.ValueDeclarationReference(declaration)})`
      return compileMemberPath(root, Type.ofReferenceRoot(site), value.members)
    },
  })
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
    const completenessFields = Type.completenessFieldsOf(current)
    const completenessType = completenessFields && Type.completenessMemberType(member)
    if (completenessFields && completenessType) {
      flushPlainMembers()
      compiled = compileCompletenessMember(compiled, member, completenessFields)
      current = completenessType
      continue
    }
    const negativeField = current.kind === 'entity'
      ? Type.dataFieldForMember(current.entity, member)
      : current.kind === 'item' && current.item
      ? Type.itemFields(current.item).find((field): field is AST.EntityDataField =>
        AST.isEntityDataField(field) && field.negativeName === member
      )
      : undefined
    if (negativeField?.negativeName === member) {
      flushPlainMembers()
      compiled = gen`TR.Unary('not', TR.Member(${compiled}, [${gen.jsLiteral(negativeField.name)}]))`
      current = Type.dataFieldValueType(negativeField)
      continue
    }
    plainMembers.push(member)
    current = Type.atMemberPath(current, [member])
  }
  flushPlainMembers()
  return compiled
}

/**
 * `Incomplete` and `Problems` read a row's or projection's `required` fields. Which fields carry a
 * sentence is known here, so it is compiled in rather than carried by every runtime value.
 */
function compileCompletenessMember(
  compiled: Compiled,
  member: string,
  fields: readonly ASTUtils.DataFieldDefinition[],
): Compiled {
  const required = fields.flatMap(field => {
    const sentence = Type.requiredSentence(field)
    return sentence === undefined ? [] : [gen`[${gen.jsLiteral(field.name)}, ${gen.jsLiteral(sentence)}]`]
  })
  const helper = member === 'IsComplete'
    ? 'IsComplete'
    : member === 'IsIncomplete'
    ? 'IsIncomplete'
    : member === 'Incomplete'
    ? 'Incomplete'
    : 'Problems'
  return gen`TR.${helper}(${compiled}, [${gen.join(required, field => field)}])`
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

/** Unions containing quantities preserve their wrappers and unwrap ordinary data branches. */
function typeContainsQuantity(type: ASTUtils.TaoType): boolean {
  return !!Type.quantityOwner(type) || abstractNumericDomain(type)
    || type.kind === 'union' && type.members.some(typeContainsQuantity)
}

function abstractNumericDomain(type: ASTUtils.TaoType): boolean {
  return primitiveNamed(type, 'numeric') && Type.isAbstractDomain(type)
}

/** nativeResultMembers flattens result unions without inventing an owner for ordinary branches. */
function nativeResultMembers(type: ASTUtils.TaoType): readonly ASTUtils.TaoType[] {
  return type.kind === 'union' ? type.members.flatMap(nativeResultMembers) : [type]
}

/** Disjoint primitive native data keeps raw passage; numeric backing is finite at ingress. */
function nativePrimitiveResultBranch(type: ASTUtils.TaoType): Compiled | undefined {
  if (type.kind !== 'primitive') {
    return undefined
  }
  const rawNumber = () => gen`if (typeof result === 'number') return TR.Value(result);`
  const rawText = () => gen`if (typeof result === 'string') return TR.Value(result);`
  const unsupported = () => undefined
  return Switch(type.primitive, {
    numeric: () =>
      gen`if (typeof result === 'number') return TR.Value(TR.checkedNumericBacking(result, ${
        gen.jsLiteral(Type.displayName(type))
      }));`,
    number: rawNumber,
    time: rawNumber,
    duration: rawNumber,
    text: rawText,
    color: rawText,
    shortcut: rawText,
    boolean: () => gen`if (typeof result === 'boolean') return TR.Value(result);`,
    none: () => gen`if (result === null) return TR.Value(result);`,
    action: unsupported,
    command: unsupported,
    design: unsupported,
    view: unsupported,
    rendered: unsupported,
    scene: unsupported,
    nav: unsupported,
    datasource: unsupported,
    data: unsupported,
    app: unsupported,
  })
}

function ratioOf(family: ASTUtils.UnitFamily, unit: string): number {
  const ratio = Units.ratioToBase(family, unit)
  Assert.defined(ratio, 'validated unit accessor names a unit of its family', { family, unit })
  return ratio
}

/** Offline scopes are symbolic account relations; no account is read during module initialization. */
function compileOfflineScope(entry: AST.ConfigurationEntry): { entity: string; field: string; actor: 'account' } {
  const target = entry.reference?.ref
  const expression = entry.memberReference ?? (AST.isAliasDeclaration(target) ? target.value : undefined)
  const path = AST.isAuthLibraryDeclaration(target, 'Account')
    ? []
    : expression
    ? AST.authAccountPath(expression)
    : undefined
  Assert.defined(path, 'validated Offline scope is rooted at the current Account')
  if (path.length === 0) {
    return { entity: 'Account', field: 'id', actor: 'account' }
  }
  const account = activeDataStorePlan()?.stores.flatMap(store => store.collections).find(entity =>
    entity.singularName === 'Account'
  )
  Assert.defined(account, 'validated Offline scope has an Account entity')
  const relation = Type.dataFields(account).find(field => field.name === path[0])
  Assert.defined(relation, 'validated Offline scope names an Account relation')
  const entity = Type.dataFieldRelationEntity(relation)
  Assert.defined(entity, 'validated Offline scope has an entity target')
  const inverse = Type.dataFields(entity).find(field =>
    Type.dataFieldRelationEntity(field) === account && !Type.dataFieldIsInverseRelation(field)
  )
  Assert.defined(inverse, 'validated Offline scope has one stored inverse relation')
  return { entity: entity.singularName, field: inverse.name, actor: 'account' }
}
