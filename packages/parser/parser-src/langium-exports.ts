import * as langium from 'langium'
import * as langiumGenerate from 'langium/generate'
import * as langiumNode from 'langium/node'

/** Langium exposes the Langium runtime, node, and generator APIs used by Tao packages. */
export const Langium = {
  ...langium,
  ...langiumGenerate,
  ...langiumNode,
}

export namespace Langium {
  /** AstNode declares any Langium AST node. */
  export type AstNode = langium.AstNode
  /** DefaultSharedCoreModuleContext declares the host services needed to create Langium shared services. */
  export type DefaultSharedCoreModuleContext = langium.DefaultSharedCoreModuleContext
  /** LangiumCoreServices declares language-specific Langium services. */
  export type LangiumCoreServices = langium.LangiumCoreServices
  /** LangiumDocument declares a parsed Langium document with an AST root. */
  export type LangiumDocument<T extends langium.AstNode = langium.AstNode> = langium.LangiumDocument<T>
  /** LangiumSharedCoreServices declares Langium services shared by all registered languages. */
  export type LangiumSharedCoreServices = langium.LangiumSharedCoreServices
  /** Reference declares a Langium cross-reference to an AST node. */
  export type Reference<T extends langium.AstNode = langium.AstNode> = langium.Reference<T>
  /** URI declares a Langium URI value. */
  export type URI = langium.URI
}
