import ASTUtils from '@ast-utils'
import { AST } from '@parser'
import { InferenceRuleNotApplicable, isType, type Type } from 'typir'
import type { LangiumTypeSystemDefinition, TypirLangiumServices, TypirLangiumSpecifics } from 'typir-langium'
import { registerInvocationTypeValidation } from './invocations-validator'

/** TaoSpecifics binds Tao AST types to Typir-Langium services. */
export interface TaoSpecifics extends TypirLangiumSpecifics {
  LanguageType: AST.Node
  AstTypes: AST.TaoLangAstType
}

/** TaoTypirServices declares the Typir services configured for Tao. */
export type TaoTypirServices = TypirLangiumServices<TaoSpecifics>

/** NO_DOCUMENT_ERROR is the Typir-Langium cache error for unlinked AST nodes. */
const NO_DOCUMENT_ERROR = 'AST node has no document'

const activeInferenceNodes = new WeakSet<AST.Node>()

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

    registerInvocationTypeValidation(typir)
  }

  /** onNewAstNode handles AST-instance-specific type creation. */
  onNewAstNode(): void {}
}

/** taoPrimitiveType returns the Typir primitive for a Tao primitive type. */
function taoPrimitiveType(type: AST.PrimitiveType, typir: TaoTypirServices): Type | undefined {
  return typir.factory.Primitives.get({ primitiveName: type })
}

/** astNodeHasDocument returns true when Typir can safely cache inference for `node`. */
function astNodeHasDocument(node: AST.Node | undefined): node is AST.Node {
  if (!node) {
    return false
  }
  try {
    ASTUtils.getDocument(node)
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
  if (activeInferenceNodes.has(node)) {
    return undefined
  }

  activeInferenceNodes.add(node)
  let inferred: unknown
  try {
    inferred = typir.Inference.inferType(node)
  } catch (error) {
    if (error instanceof Error && error.message.includes(NO_DOCUMENT_ERROR)) {
      return undefined
    }
    throw error
  } finally {
    activeInferenceNodes.delete(node)
  }
  return isType(inferred) ? inferred : undefined
}
