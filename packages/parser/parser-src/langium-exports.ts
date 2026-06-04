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
  /** Generated declares one Langium generator contribution. */
  export type Generated = langiumGenerate.Generated
  /** GeneratorNode declares a structured Langium generator node. */
  export type GeneratorNode = langiumGenerate.GeneratorNode
  /** LangiumCoreServices declares language-specific Langium services. */
  export type LangiumCoreServices = langium.LangiumCoreServices
  /** LangiumDocument declares a parsed Langium document with an AST root. */
  export type LangiumDocument<T extends AstNode = AstNode> = langium.LangiumDocument<T>
  /** LangiumSharedCoreServices declares Langium services shared by all registered languages. */
  export type LangiumSharedCoreServices = langium.LangiumSharedCoreServices
  /** Reference declares a Langium cross-reference to an AST node. */
  export type Reference<T extends AstNode = AstNode> = langium.Reference<T>
  /** URI declares a Langium URI value. */
  export type URI = langium.URI
}
