import { Type as TaoType } from '@ast-utils'
import { AST } from '@parser'
import { Switch } from '@shared'
import { InferenceRuleNotApplicable, type Type as TypirType } from 'typir'
import type { LangiumTypeSystemDefinition } from 'typir-langium'
import { ActionsValidator } from './ActionsValidator'
import { InvocationsValidator } from './invocations-validator'
import { StateValidator } from './StateValidator'
import { type TaoSpecifics, type TaoTypirServices, TypeSystemHelpers } from './TypeSystemHelpers'

const statefulPrimitiveTypes = ['text', 'number'] as const satisfies readonly AST.PrimitiveType[]

export type { TaoSpecifics, TaoTypirServices } from './TypeSystemHelpers'

/** TaoTypeSystem registers Tao primitive types, expression inference, and Typir validation hooks. */
export class TaoTypeSystem implements LangiumTypeSystemDefinition<TaoSpecifics> {
  /** onInitialize registers static Tao type rules. */
  onInitialize(typir: TaoTypirServices): void {
    typir.factory.Primitives.create({ primitiveName: 'text' })
      .inferenceRule({ filter: AST.isStringLiteral })
      .finish()

    typir.factory.Primitives.create({ primitiveName: 'number' })
      .inferenceRule({ filter: AST.isNumberLiteral })
      .finish()

    typir.factory.Primitives.create({ primitiveName: 'action' })
      .inferenceRule({ filter: AST.isActionExpression })
      .finish()

    typir.factory.Primitives.create({ primitiveName: 'item' }).finish()
    typir.factory.Primitives.create({ primitiveName: 'list' })
      .inferenceRule({ filter: AST.isListLiteral })
      .finish()

    for (const primitive of statefulPrimitiveTypes) {
      const baseType = TypeSystemHelpers.taoPrimitiveType(primitive, typir)
      const statefulType = typir.factory.Primitives.create({ primitiveName: statefulPrimitiveName(primitive) })
        .finish()
      if (baseType) {
        typir.Conversion.markAsConvertible(statefulType, baseType, 'IMPLICIT_EXPLICIT')
      }
    }

    typir.Inference.addInferenceRulesForAstNodes({
      MemberAccessExpression: (node) =>
        TypeSystemHelpers.taoType(TaoType.ofMemberAccess(node), typir)
          ?? InferenceRuleNotApplicable,
      TypeCastExpression: (node) =>
        TypeSystemHelpers.taoType(TaoType.ofReference(node.type), typir)
          ?? InferenceRuleNotApplicable,
      TypedConstructor: (node) =>
        TypeSystemHelpers.taoType(TaoType.ofConstructorReference(node.type), typir)
          ?? InferenceRuleNotApplicable,
      ValueReference: (node) => {
        const target = node.target.ref
        if (!target) {
          return InferenceRuleNotApplicable
        }
        return Switch.type(target, {
          ActionDeclaration: () => TypeSystemHelpers.taoPrimitiveType('action', typir) ?? InferenceRuleNotApplicable,
          AliasDeclaration: alias => TypeSystemHelpers.safeInferType(typir, alias.value) ?? InferenceRuleNotApplicable,
          ParameterDeclaration: parameter =>
            TypeSystemHelpers.taoPrimitiveType(parameter.type, typir) ?? InferenceRuleNotApplicable,
          StateDeclaration: state => TypeSystemHelpers.safeInferType(typir, state) ?? InferenceRuleNotApplicable,
        })
      },
      StateDeclaration: (node) => {
        const valueType = TypeSystemHelpers.safeInferType(typir, node.value)
        const underlying = TypeSystemHelpers.underlyingPrimitiveName(valueType)
        return underlying
          ? taoStatefulPrimitiveType(underlying, typir) ?? InferenceRuleNotApplicable
          : InferenceRuleNotApplicable
      },
    })

    ActionsValidator.registerTypeValidation(typir)
    StateValidator.registerTypeValidation(typir)
    InvocationsValidator.registerTypeValidation(typir)
  }

  /** onNewAstNode handles AST-instance-specific type creation. */
  onNewAstNode(node: AST.Node, typir: TaoTypirServices): void {
    if (AST.isTypeDeclaration(node)) {
      TypeSystemHelpers.ensurePrimitive(TypeSystemHelpers.typirTypeDefinitionName(node), typir)
    }
    if (AST.isTypeProperty(node) && node.type) {
      TypeSystemHelpers.ensurePrimitive(TypeSystemHelpers.typirTypeDefinitionName(node), typir)
    }
  }
}

function taoStatefulPrimitiveType(
  type: AST.PrimitiveType,
  typir: TaoTypirServices,
): TypirType | undefined {
  return typir.factory.Primitives.get({ primitiveName: statefulPrimitiveName(type) })
}

function statefulPrimitiveName(type: AST.PrimitiveType): string {
  return `stateful ${type}`
}
