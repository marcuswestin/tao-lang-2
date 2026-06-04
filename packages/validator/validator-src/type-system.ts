import { AST, Langium } from '@parser'
import { InferenceRuleNotApplicable, isType, type Type } from 'typir'
import type { LangiumTypeSystemDefinition, TypirLangiumServices, TypirLangiumSpecifics } from 'typir-langium'
import { invocationValidationMessages, resolveRenderInvocation } from './invocations-validator'

/** TaoSpecifics binds Tao AST types to Typir-Langium services. */
export interface TaoSpecifics extends TypirLangiumSpecifics {
  LanguageType: AST.Node
  AstTypes: AST.TaoLangAstType
}

/** TaoTypirServices declares the Typir services configured for Tao. */
export type TaoTypirServices = TypirLangiumServices<TaoSpecifics>

/** NO_DOCUMENT_ERROR is the Typir-Langium cache error for unlinked AST nodes. */
export const NO_DOCUMENT_ERROR = 'AST node has no document'

/** TaoTypeSystem registers Tao primitive types, expression inference, and invocation type checks. */
export class TaoTypeSystem implements LangiumTypeSystemDefinition<TaoSpecifics> {
  /** onInitialize registers static Tao type rules. */
  onInitialize(typir: TaoTypirServices): void {
    typir.factory.Primitives.create({ primitiveName: 'text' })
      .inferenceRule({ filter: AST.isStringLiteral })
      .finish()

    typir.factory.Primitives.create({ primitiveName: 'number' })
      .inferenceRule({ filter: AST.isNumberLiteral })
      .finish()

    typir.Inference.addInferenceRulesForAstNodes({
      ValueReference: (node) => {
        const target = node.target.ref
        if (AST.isAliasDeclaration(target)) {
          return safeInferType(typir, target.value) ?? InferenceRuleNotApplicable
        }
        if (AST.isParameterDeclaration(target)) {
          return taoPrimitiveType(target.type, typir) ?? InferenceRuleNotApplicable
        }
        return InferenceRuleNotApplicable
      },
    })

    typir.validation.Collector.addValidationRulesForAstNodes({
      Render: (render, accept, services) => {
        const invocation = resolveRenderInvocation(render)
        for (const pair of invocation.pairs) {
          const expected = taoPrimitiveType(pair.parameter.type, services as TaoTypirServices)
          services.validation.Constraints.ensureNodeIsAssignable(pair.argument.value, expected, accept, (actual) => ({
            languageNode: pair.argument.value,
            message: invocationValidationMessages.typeMismatch(pair.parameter, actual.name),
          }))
        }
      },
    })
  }

  /** onNewAstNode handles AST-instance-specific type creation. */
  onNewAstNode(): void {}
}

/** taoPrimitiveType returns the Typir primitive for a Tao primitive type. */
export function taoPrimitiveType(type: AST.PrimitiveType, typir: TaoTypirServices): Type | undefined {
  return typir.factory.Primitives.get({ primitiveName: type })
}

/** astNodeHasDocument returns true when Typir can safely cache inference for `node`. */
export function astNodeHasDocument(node: AST.Node | undefined): node is AST.Node {
  if (!node) {
    return false
  }
  try {
    Langium.AstUtils.getDocument(node)
    return true
  } catch {
    return false
  }
}

/** safeInferType infers a Tao expression type and returns undefined for unresolved Typir paths. */
export function safeInferType(typir: TaoTypirServices, node: AST.Node | undefined): Type | undefined {
  if (!astNodeHasDocument(node)) {
    return undefined
  }
  let inferred: unknown
  try {
    inferred = typir.Inference.inferType(node)
  } catch (error) {
    if (error instanceof Error && error.message.includes(NO_DOCUMENT_ERROR)) {
      return undefined
    }
    throw error
  }
  return isType(inferred) ? inferred : undefined
}
