import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Switch } from '@shared'
import { isType, type Type as TypirType } from 'typir'
import type { TypirLangiumServices, TypirLangiumSpecifics } from 'typir-langium'

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
const primitiveTypes = [
  'text',
  'number',
  'boolean',
  'action',
  'item',
  'list',
] as const satisfies readonly AST.PrimitiveType[]

/** TypeSystemHelpers groups Tao Typir helper functions. */
export const TypeSystemHelpers = {
  ensurePrimitive,
  safeInferType,
  taoPrimitiveType,
  taoType,
  typirTypeDefinitionName,
  underlyingPrimitiveName,
}

/** taoPrimitiveType returns the Typir primitive for a Tao primitive type. */
function taoPrimitiveType(
  type: AST.PrimitiveType | 'none' | AST.TypeReference | ASTUtils.TaoType,
  typir: TaoTypirServices,
): TypirType | undefined {
  if (typeof type === 'string') {
    return typir.factory.Primitives.get({ primitiveName: type })
  }
  if (AST.isTypeReference(type)) {
    return taoType(Type.ofReference(type), typir)
  }
  return taoType(type, typir)
}

/** taoType returns the Typir type matching a statically resolved Tao type. */
function taoType(type: ASTUtils.TaoType, typir: TaoTypirServices): TypirType | undefined {
  return Switch.kind(type, {
    unresolved: () => undefined,
    primitive: type =>
      type.nominal
        ? ensurePrimitive(typirTypeDefinitionName(type.nominal), typir)
        : taoPrimitiveType(type.primitive, typir),
    item: type =>
      type.nominal
        ? ensurePrimitive(typirTypeDefinitionName(type.nominal), typir)
        : taoPrimitiveType(type.kind, typir),
    list: type =>
      type.nominal
        ? ensurePrimitive(typirTypeDefinitionName(type.nominal), typir)
        : taoPrimitiveType(type.kind, typir),
  })
}

/** ensurePrimitive returns an existing Typir primitive or creates it for nominal Tao types. */
function ensurePrimitive(name: string, typir: TaoTypirServices): TypirType | undefined {
  const existing = typir.factory.Primitives.get({ primitiveName: name })
  if (existing) {
    return existing
  }
  return typir.factory.Primitives.create({ primitiveName: name }).finish()
}

/** typirTypeDefinitionName returns a document-qualified Typir name for a Tao type definition. */
function typirTypeDefinitionName(definition: AST.TypeDefinition): string {
  try {
    return `${AST.getDocument(definition).uri.path}#${Type.definitionName(definition)}`
  } catch {
    return Type.definitionName(definition)
  }
}

/** underlyingPrimitiveName returns the base primitive name for primitive and stateful primitive types. */
function underlyingPrimitiveName(type: TypirType | undefined): AST.PrimitiveType | undefined {
  const name = type?.getName()
  if (!name) {
    return undefined
  }
  if (isPrimitiveTypeName(name)) {
    return name
  }
  const statefulPrefix = 'stateful '
  if (!name.startsWith(statefulPrefix)) {
    return undefined
  }
  const underlying = name.slice(statefulPrefix.length)
  return isPrimitiveTypeName(underlying) ? underlying : undefined
}

function isPrimitiveTypeName(name: string): name is AST.PrimitiveType {
  return primitiveTypes.includes(name as AST.PrimitiveType)
}

/** astNodeHasDocument returns true when Typir can safely cache inference for `node`. */
function astNodeHasDocument(node: AST.Node | undefined): node is AST.Node {
  if (!node) {
    return false
  }
  try {
    AST.getDocument(node)
    return true
  } catch {
    return false
  }
}

/** safeInferType infers a Tao expression type and returns undefined for unresolved Typir paths. */
function safeInferType(typir: TaoTypirServices, node: AST.Node | undefined): TypirType | undefined {
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
