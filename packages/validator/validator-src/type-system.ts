import ASTUtils, { Type } from '@ast-utils'
import { AST } from '@parser'
import { InferenceRuleNotApplicable, isType, type Type as TypirType } from 'typir'
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

    typir.factory.Primitives.create({ primitiveName: 'item' }).finish()
    typir.factory.Primitives.create({ primitiveName: 'list' })
      .inferenceRule({ filter: AST.isListLiteral })
      .finish()

    typir.Inference.addInferenceRulesForAstNodes({
      MemberAccessExpression: (node) => taoType(Type.ofMemberAccess(node), typir) ?? InferenceRuleNotApplicable,
      TypeCastExpression: (node) => taoType(Type.ofReference(node.type), typir) ?? InferenceRuleNotApplicable,
      TypedConstructor: (node) => taoType(Type.ofConstructorReference(node.type), typir) ?? InferenceRuleNotApplicable,
      ValueReference: (node) => {
        const target = node.target.ref
        if (AST.isAliasDeclaration(target)) {
          return safeInferType(typir, target.value) ?? InferenceRuleNotApplicable
        }
        if (AST.isParameterDeclaration(target)) {
          return taoType(Type.ofParameter(target), typir) ?? InferenceRuleNotApplicable
        }
        return InferenceRuleNotApplicable
      },
    })

    registerInvocationTypeValidation(typir)
  }

  /** onNewAstNode handles AST-instance-specific type creation. */
  onNewAstNode(node: AST.Node, typir: TaoTypirServices): void {
    if (AST.isTypeDeclaration(node)) {
      ensurePrimitive(typirTypeDefinitionName(node), typir)
    }
    if (AST.isTypeProperty(node) && node.type) {
      ensurePrimitive(typirTypeDefinitionName(node), typir)
    }
  }
}

/** taoPrimitiveType returns the Typir primitive for a Tao primitive type. */
function taoPrimitiveType(type: AST.PrimitiveType, typir: TaoTypirServices): TypirType | undefined {
  return typir.factory.Primitives.get({ primitiveName: type })
}

function taoType(type: Type.TaoType, typir: TaoTypirServices): TypirType | undefined {
  if (type.kind === 'unresolved') {
    return undefined
  }
  if (type.nominal) {
    return ensurePrimitive(typirTypeDefinitionName(type.nominal), typir)
  }
  if (type.kind === 'primitive') {
    return taoPrimitiveType(type.primitive, typir)
  }
  return taoPrimitiveType(type.kind, typir)
}

function ensurePrimitive(name: string, typir: TaoTypirServices): TypirType | undefined {
  const existing = typir.factory.Primitives.get({ primitiveName: name })
  if (existing) {
    return existing
  }
  return typir.factory.Primitives.create({ primitiveName: name }).finish()
}

function typirTypeDefinitionName(definition: AST.TypeDefinition): string {
  try {
    return `${ASTUtils.getDocument(definition).uri.path}#${Type.definitionName(definition)}`
  } catch {
    return Type.definitionName(definition)
  }
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
export function safeInferType(typir: TaoTypirServices, node: AST.Node | undefined): TypirType | undefined {
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
